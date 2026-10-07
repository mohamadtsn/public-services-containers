.PHONY: help install build dev test typecheck lint release release-minor release-major release-dry

.DEFAULT_GOAL := help

CYAN   := \033[0;36m
GREEN  := \033[0;32m
YELLOW := \033[0;33m
RESET  := \033[0m

help: ## Show this help message
	@awk 'BEGIN {FS = ":.*##"; printf "$(CYAN)pubservices$(RESET) — development tasks\n\nUsage:\n  make $(GREEN)<target>$(RESET)\n\nTargets:\n"} \
	     /^[a-zA-Z_-]+:.*?##/ { printf "  $(GREEN)%-16s$(RESET) %s\n", $$1, $$2 } \
	     /^##@/ { printf "\n$(CYAN)%s$(RESET)\n", substr($$0, 5) }' $(MAKEFILE_LIST)
	@echo ""
	@echo "$(YELLOW)Running the stack is the CLI's job:$(RESET) pubservices up --full, pubservices status, ..."
	@echo ""

##@ Development

install: ## Install dependencies
	npm ci

build: ## Build dist/
	npm run build

dev: ## Rebuild on change
	npm run dev

test: ## Run the test suite (starts a sandbox Docker stack)
	npm test

typecheck: ## Type-check without emitting
	npm run typecheck

lint: ## Type-check and shellcheck the release script
	@npm run typecheck
	@if command -v shellcheck >/dev/null 2>&1; then \
		shellcheck scripts/release.sh; \
		echo "$(GREEN)✓ shellcheck passed$(RESET)"; \
	else \
		echo "$(YELLOW)! shellcheck not installed — skipping$(RESET)"; \
	fi

##@ Release

release: ## Bump patch version and release
	@scripts/release.sh patch

release-minor: ## Bump minor version and release
	@scripts/release.sh minor

release-major: ## Bump major version and release
	@scripts/release.sh major

release-dry: ## Preview the next patch release
	@scripts/release.sh patch --dry-run
