---
name: sidekiq-monitor
version: 1.0.0
description: |
  Live Sidekiq queue health monitor for Rails + Sidekiq + Redis stacks.
  Checks queue depths, busy workers, dead jobs, retry exhaustion, scheduled
  job backlog, and slow queue trends. Extends /rails-health with live
  runtime data — run when Sidekiq is actually running, not just for static
  code analysis. Works via Redis CLI, Sidekiq Web UI, or Rails console.
  Use when: "sidekiq health", "check the queues", "sidekiq monitor",
  "jobs failing", "queue depth", "dead jobs", "sidekiq stuck". (g6)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - AskUserQuestion
triggers:
  - sidekiq health
  - check the queues
  - sidekiq monitor
  - jobs failing
  - queue depth
  - dead jobs
  - sidekiq stuck
---

# /sidekiq-monitor

Live Sidekiq queue health — queue depths, dead jobs, retry exhaustion, stuck workers.

Use this when Sidekiq is running and you need to know what's actually happening.
For static code analysis (job config, retry settings), use `/rails-health` instead.

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"

# Check Redis connection
redis-cli ping 2>/dev/null || echo "Redis: not reachable on default port"

# Check Sidekiq config
cat config/sidekiq.yml 2>/dev/null | head -20 || echo "No config/sidekiq.yml"

# Check Redis URL config
grep -rn "REDIS_URL\|redis_url\|redis://" \
  config/ .env 2>/dev/null | grep -v ".git/\|secret\|password" | head -5
```

Read CLAUDE.md for the Redis URL. If Redis is not reachable, ask the user to provide the Redis URL or connection details before continuing.

## Step 1: Queue depths

```bash
# All queues and their depths
redis-cli LLEN sidekiq:queue:default 2>/dev/null | xargs echo "default:"
# Use SCAN instead of KEYS — KEYS is O(N) and blocks Redis in production
cursor=0
while true; do
  result=$(redis-cli SCAN $cursor MATCH "sidekiq:queue:*" COUNT 100 2>/dev/null)
  cursor=$(echo "$result" | head -1)
  echo "$result" | tail -n +2 | while read q; do
    name=$(echo $q | sed 's/sidekiq:queue://')
    depth=$(redis-cli LLEN "$q" 2>/dev/null || echo "?")
    echo "$name: $depth jobs"
  done
  [ "$cursor" = "0" ] && break
done
```

If running inside the Rails app, prefer:
```bash
bundle exec rails runner "
  require 'sidekiq/api'
  Sidekiq::Queue.all.each do |q|
    puts \"#{q.name}: #{q.size} jobs (latency: #{q.latency.round(1)}s)\"
  end
" 2>/dev/null
```

Flag queues with:
- **Depth > 100**: actively backed up
- **Latency > 60s**: jobs sitting in queue more than a minute before being picked up
- **Depth growing** (check twice, 30s apart): active backlog buildup

## Step 2: Busy workers

```bash
bundle exec rails runner "
  require 'sidekiq/api'
  workers = Sidekiq::Workers.new
  puts \"Busy: #{workers.size} workers\"
  workers.each do |process_id, thread_id, work|
    job = work['payload']
    started = Time.at(work['run_at']).utc
    runtime = (Time.now.utc - started).round
    puts \"  #{job['class']} — running #{runtime}s (queue: #{job['queue']})\"
  end
" 2>/dev/null
```

Flag workers running longer than:
- **5 minutes** for jobs that should be fast (email sends, webhook deliveries)
- **30 minutes** for any job — likely stuck or hung

## Step 3: Retry set

```bash
bundle exec rails runner "
  require 'sidekiq/api'
  retry_set = Sidekiq::RetrySet.new
  puts \"Retries scheduled: #{retry_set.size}\"
  retry_set.to_a.first(10).each do |job|
    puts \"  #{job['class']} — retried #{job['retry_count']}x, next at #{Time.at(job['at']).utc}\"
    puts \"    error: #{job['error_message']&.truncate(100)}\"
  end
" 2>/dev/null
```

Group retrying jobs by class and error message. The top 3 most-retried job classes are your active problems. For each:
- Is the error transient (network timeout, rate limit) or persistent (bug)?
- How many retries remain before it hits the dead set?
- Is the underlying cause something that needs a deploy to fix?

## Step 4: Dead set

```bash
bundle exec rails runner "
  require 'sidekiq/api'
  dead = Sidekiq::DeadSet.new
  puts \"Dead jobs: #{dead.size}\"
  dead.to_a.last(20).each do |job|
    puts \"  #{job['class']} — died at #{Time.at(job['at']).utc}\"
    puts \"    error: #{job['error_message']&.truncate(120)}\"
  end
" 2>/dev/null
```

Dead jobs are jobs that exhausted all retries. They represent work that was permanently lost.

For each dead job class: is this data that needs to be recovered? If so, you can re-enqueue from the dead set:
```ruby
# In rails console — re-enqueue all dead MyJob jobs
Sidekiq::DeadSet.new.select { |j| j['class'] == 'MyJob' }.each(&:retry)
```

## Step 5: Scheduled jobs

```bash
bundle exec rails runner "
  require 'sidekiq/api'
  scheduled = Sidekiq::ScheduledSet.new
  puts \"Scheduled: #{scheduled.size} jobs\"
  # Show jobs scheduled in next 1 hour
  soon = scheduled.select { |j| j.at < Time.now + 3600 }
  soon.first(10).each do |job|
    puts \"  #{job['class']} at #{Time.at(job['at']).utc}\"
  end
" 2>/dev/null
```

Also check for sidekiq-cron or whenever scheduled jobs:
```bash
# sidekiq-cron
bundle exec rails runner "
  require 'sidekiq-cron'
  Sidekiq::Cron::Job.all.each do |job|
    puts \"#{job.name}: #{job.cron} — last: #{job.last_enqueue_time}\"
  end
" 2>/dev/null || echo "sidekiq-cron not installed"
```

Flag cron jobs that haven't run when expected (last_enqueue_time older than 2x their interval).

## Step 6: Process health

```bash
bundle exec rails runner "
  require 'sidekiq/api'
  processes = Sidekiq::ProcessSet.new
  puts \"Processes: #{processes.size}\"
  processes.each do |p|
    puts \"  #{p['hostname']} — #{p['busy']}/#{p['concurrency']} busy, queues: #{p['queues'].join(', ')}\"
    puts \"    started: #{Time.at(p['started_at']).utc}, heartbeat: #{Time.at(p['heartbeat_at']).utc}\"
  end
" 2>/dev/null
```

Flag:
- **Heartbeat older than 60s**: process may be dead but not cleaned up
- **0 processes**: Sidekiq is not running — all jobs will pile up
- **All workers busy**: at concurrency ceiling, new jobs will wait

## Step 7: Health report

```
Sidekiq Health Report — [project] — [timestamp]
================================================
Processes running:  X (Y/Z concurrency used)

Queues:
  default:    X jobs  (latency: Xs)  HEALTHY / BACKED UP
  [name]:     X jobs  (latency: Xs)  HEALTHY / BACKED UP

Retrying:       X jobs
  Top errors: [JobClass] (Nx) — [error summary]

Dead:           X jobs
  [JobClass] (Nx) — [last error]

Scheduled:      X upcoming
  Cron jobs:  X active, Y overdue

Overall: HEALTHY / DEGRADED / CRITICAL
```

**CRITICAL** — Sidekiq not running, or dead set growing rapidly, or queue latency >5min.
**DEGRADED** — Queue backed up, retries climbing, 1-2 dead job classes.
**HEALTHY** — Queues draining, no dead jobs, workers processing normally.

For each non-HEALTHY finding, provide the specific remediation: restart command, re-enqueue snippet, or code fix needed.
