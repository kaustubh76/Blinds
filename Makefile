# THE WINDOW for Stocks — top-level targets. Every target is also what CI runs.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
PROFILE ?= demo

.PHONY: help build test lint fmt check-localnet test-integration demo deploy-devnet freeze clean

help: ## list targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

build: ## anchor build (5 programs -> target/deploy, target/idl) + freeze IDLs into sdk/idl
	anchor build
	./scripts/sync_idl.sh

fmt: ## rustfmt + biome format
	cargo fmt --all
	pnpm biome format --write .

lint: ## clippy -D warnings + biome check + honest-claims + lineage
	cargo lint
	pnpm lint
	./scripts/check_claims.sh
	./scripts/check_lineage.sh

test: ## tier 1: crates + programs on LiteSVM (needs `make build` first for the .so files)
	cargo test --workspace
	pnpm test

check-localnet: ## assert a local validator is up with the ZK ElGamal program and Token-2022
	./scripts/check_localnet.sh

test-integration: ## tier 2: real solana-test-validator through the TS SDK, real services
	WINDOW_PROFILE=integration ./scripts/localnet.sh test

demo: ## one full epoch on localnet with the DEMO profile; exits 0 when epoch 1 is Printed and re-verified
	WINDOW_PROFILE=$(PROFILE) ./scripts/localnet.sh demo

deploy-devnet: ## deploy all programs to devnet and initialise state
	./scripts/deploy_devnet.sh

freeze: ## set upgrade authority to None on every devnet program (irreversible)
	./scripts/freeze.sh

clean:
	rm -rf target .anchor test-ledger sdk/dist app/dist
