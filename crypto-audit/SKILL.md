---
name: crypto-audit
version: 1.0.0
description: |
  Security audit specific to Bitcoin and cryptocurrency code. Checks key generation
  entropy, seed phrase handling and storage, private key exposure in logs or responses,
  address validation, transaction signing patterns, wallet encryption, and multi-chain
  self-custody risks. Standard /cso does not cover these patterns.
  Use when: "crypto audit", "bitcoin security", "wallet audit", "check the wallet code",
  "seed phrase security", "key generation review". (g6)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - WebSearch
  - AskUserQuestion
triggers:
  - crypto audit
  - bitcoin security
  - wallet audit
  - seed phrase security
  - key generation review
---

# /crypto-audit

Cryptocurrency security audit — Bitcoin, multi-chain, self-custody wallet patterns.

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/g6/bin/gstack-update-check 2>/dev/null || .claude/skills/g6/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "PWD: $(pwd)"

# Detect crypto libraries in use
grep -rn "bitcoin\|secp256k1\|bip32\|bip39\|hdwallet\|web3\|ethers\|solana\|bitcoinjs\|trezor\|ledger" \
  requirements.txt pyproject.toml package.json Gemfile 2>/dev/null | \
  grep -v ".git/\|#\|test" | head -20

echo "=== Crypto stack detected ==="
```

## Step 1: Key generation — entropy and randomness

```bash
# Check for cryptographically secure RNG
grep -rn "random\.\|Math\.random\|rand(\|os\.urandom\|secrets\.\|crypto\.randomBytes\|SecureRandom" \
  --include="*.py" --include="*.rb" --include="*.ts" --include="*.js" --include="*.swift" --include="*.kt" \
  . 2>/dev/null | grep -v ".git/\|test\|spec\|#" | head -30

# Insecure RNG patterns (CRITICAL if found in key generation)
grep -rn "Math\.random()\|random\.random()\|rand()\b" \
  --include="*.py" --include="*.rb" --include="*.ts" --include="*.js" \
  . 2>/dev/null | grep -v ".git/\|test\|spec\|#" | head -20
```

Flag: `Math.random()`, `random.random()`, or `rand()` near any key or seed generation — these are NOT cryptographically secure. Must use `os.urandom()`, `secrets.token_bytes()`, `crypto.randomBytes()`, or platform SecureRandom.

## Step 2: Seed phrase and mnemonic handling

```bash
# Seed phrase / mnemonic generation and storage
grep -rn "mnemonic\|seed_phrase\|bip39\|generate_mnemonic\|Mnemonic\|wordlist\|entropy" \
  --include="*.py" --include="*.rb" --include="*.ts" --include="*.js" --include="*.swift" --include="*.kt" \
  . 2>/dev/null | grep -v ".git/\|test\|spec" | head -30

# Seed phrases in logs (CRITICAL)
grep -rn "logger\.\|console\.log\|print(\|Rails\.logger\|NSLog\|Log\." \
  --include="*.py" --include="*.rb" --include="*.ts" --include="*.js" --include="*.swift" --include="*.kt" \
  . 2>/dev/null | grep -i "mnemonic\|seed\|phrase\|word" | grep -v ".git/\|test" | head -10

# Seed phrases in API responses
grep -rn "mnemonic\|seed_phrase\|seed_words" \
  --include="*.py" --include="*.rb" --include="*.ts" . 2>/dev/null | \
  grep -i "response\|return\|json\|render\|jsonify" | grep -v ".git/\|test" | head -10

# Storage of seed phrases (should NEVER be stored server-side in plaintext)
grep -rn "mnemonic\|seed_phrase" \
  --include="*.py" --include="*.rb" . 2>/dev/null | \
  grep -i "save\|store\|db\.\|Model\.\|create\|insert\|Column\|field\b" | \
  grep -v ".git/\|test\|encrypted\|cipher\|hash" | head -10
```

**Critical rules:**
- Seed phrases must NEVER be logged
- Seed phrases must NEVER be returned in API responses
- Seed phrases must NEVER be stored server-side in plaintext
- If stored (e.g., encrypted backup), must use AES-256-GCM or ChaCha20-Poly1305 with a user-derived key

## Step 3: Private key exposure

```bash
# Private key handling
grep -rn "private_key\|privkey\|privateKey\|wif\|WIF\|signing_key\|secret_key" \
  --include="*.py" --include="*.rb" --include="*.ts" --include="*.js" --include="*.swift" --include="*.kt" \
  . 2>/dev/null | grep -v ".git/\|test\|spec\|public_key" | head -30

# Private keys in API responses (CRITICAL)
grep -rn "private_key\|privkey\|privateKey\|wif\b" \
  --include="*.py" --include="*.rb" --include="*.ts" . 2>/dev/null | \
  grep -i "response\|return\|json\|render\|jsonify" | grep -v ".git/\|test" | head -10

# Private keys in logs
grep -rn "logger\.\|console\.log\|print(\|Rails\.logger" \
  --include="*.py" --include="*.rb" --include="*.ts" . 2>/dev/null | \
  grep -i "private\|privkey\|wif\b\|secret_key" | grep -v ".git/\|test" | head -10
```

## Step 4: Address validation

```bash
# Address validation before use
grep -rn "address\b\|addr\b" \
  --include="*.py" --include="*.rb" --include="*.ts" --include="*.js" \
  . 2>/dev/null | grep -i "valid\|verify\|check\|is_valid\|validate" | \
  grep -v ".git/\|test\|email" | head -20

# Addresses used without validation
grep -rn "send\|transfer\|broadcast\|submit_tx\|push_tx" \
  --include="*.py" --include="*.rb" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|test\|valid" | head -20
```

Flag: funds-sending functions that don't validate the recipient address before proceeding. A malformed address can result in permanent loss of funds.

## Step 5: Transaction signing patterns

```bash
# Signing operations
grep -rn "sign\b\|sign_tx\|sign_transaction\|signTransaction\|ecdsa\|schnorr" \
  --include="*.py" --include="*.rb" --include="*.ts" --include="*.js" \
  . 2>/dev/null | grep -v ".git/\|test\|verify_sig\|#" | head -20

# Offline vs online signing
grep -rn "broadcast\|send_raw\|push_tx\|submit\|broadcast_tx" \
  --include="*.py" --include="*.rb" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|test" | head -10
```

Best practice: sign transactions offline (private key never touches internet-connected code). Flag any pattern where signing and broadcasting happen in the same network-connected process with no separation.

## Step 6: Wallet encryption at rest

```bash
# Encryption of stored wallet data
grep -rn "AES\|aes\|ChaCha\|chacha\|Fernet\|encrypt\|cipher\|pbkdf2\|argon2\|scrypt\|bcrypt" \
  --include="*.py" --include="*.rb" --include="*.ts" --include="*.js" \
  . 2>/dev/null | grep -v ".git/\|test\|#" | head -20

# Wallet files stored without encryption
find . -name "*.wallet" -o -name "wallet.dat" -o -name "keystore*" 2>/dev/null | \
  grep -v ".git/\|test" | head -10

# Key derivation function usage
grep -rn "PBKDF2\|Argon2\|scrypt\|bcrypt\|kdf\b" \
  --include="*.py" --include="*.rb" --include="*.ts" . 2>/dev/null | \
  grep -v ".git/\|test" | head -10
```

Flag: wallet data encrypted with a static key or no key. Must use a key derived from user's password via Argon2id (preferred) or PBKDF2 with >=100K iterations.

## Step 7: Multi-chain and web3 specific checks (if applicable)

```bash
# Chain ID validation (EVM)
grep -rn "chainId\|chain_id\|CHAIN_ID" \
  --include="*.py" --include="*.ts" --include="*.js" . 2>/dev/null | \
  grep -v ".git/\|test" | head -10

# Contract address checksums (EVM)
grep -rn "0x[a-fA-F0-9]{40}\|toChecksumAddress\|checksum_address\|EIP55" \
  --include="*.py" --include="*.ts" . 2>/dev/null | grep -v ".git/\|test" | head -10

# Replay protection
grep -rn "nonce\|replay\|EIP155" \
  --include="*.py" --include="*.ts" . 2>/dev/null | grep -v ".git/\|test" | head -10
```

## Step 8: Dependency audit

```bash
# Crypto library versions (must be current — old versions have known vulnerabilities)
grep -E "bitcoinjs|secp256k1|bip39|bip32|web3|ethers|solana|trezor" \
  package.json requirements.txt pyproject.toml Gemfile.lock 2>/dev/null | head -20

# Check for known vulnerable versions (search if WebSearch available)
```

Search for any pinned crypto library version against its GitHub security advisories.

## Step 9: Report

```
Crypto Audit — [project] — [branch]
=====================================
Key generation entropy:  PASS / CRITICAL (insecure RNG found)
Seed phrase handling:    PASS / CRITICAL (logged/returned/stored plaintext)
Private key exposure:    PASS / CRITICAL (X leaks found)
Address validation:      PASS / WARN (X send paths unvalidated)
Transaction signing:     online (risk) / offline (good) / unclear
Wallet encryption:       AES-256-GCM/ChaCha20 / weak / none
Multi-chain:             chain ID validated / WARN / N/A
Crypto dependencies:     X libraries, versions checked
```

CRITICAL findings halt — do not deploy until resolved. These findings can result in permanent, unrecoverable user fund loss.
