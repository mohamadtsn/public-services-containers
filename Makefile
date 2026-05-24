.PHONY: help up up-proxy up-pma up-mail up-storage up-full down restart status logs reset \
        build install uninstall release release-minor release-major release-dry lint backup restore

.DEFAULT_GOAL := help

CYAN   := \033[0;36m
GREEN  := \033[0;32m
YELLOW := \033[0;33m
RED    := \033[0;31m
RESET  := \033[0m

ALL_PROFILES := --profile proxy --profile pma --profile mail --profile storage

help: ## Show this help message
	@awk 'BEGIN {FS = ":.*##"; printf "$(CYAN)Public Services$(RESET)\n\nUsage:\n  make $(GREEN)<target>$(RESET)\n\nTargets:\n"} \
	     /^[a-zA-Z_-]+:.*?##/ { printf "  $(GREEN)%-18s$(RESET) %s\n", $$1, $$2 } \
	     /^##@/ { printf "\n$(CYAN)%s$(RESET)\n", substr($$0, 5) }' $(MAKEFILE_LIST)

##@ Services

up: ## Start core services (MySQL + Redis)
	docker compose up -d

up-proxy: ## Start core + Nginx
	docker compose --profile proxy up -d

up-pma: ## Start core + phpMyAdmin
	docker compose --profile pma up -d

up-mail: ## Start core + Mailpit
	docker compose --profile mail up -d

up-storage: ## Start core + MinIO
	docker compose --profile storage up -d

up-full: ## Start all services
	docker compose $(ALL_PROFILES) up -d

down: ## Stop all services (data preserved)
	docker compose $(ALL_PROFILES) down

restart: ## Restart all running services
	docker compose $(ALL_PROFILES) restart

build: ## Rebuild Docker images (no cache)
	docker compose $(ALL_PROFILES) build --no-cache

##@ Monitoring

status: ## Show service status with ports
	@bin/pubservices status

logs: ## Follow service logs
	docker compose $(ALL_PROFILES) logs -f

##@ Data

reset: ## Stop services and remove all data (DESTRUCTIVE)
	@echo "$(RED)Warning: This will permanently delete all data!$(RESET)"
	@read -p "Type 'yes' to confirm: " confirm && [ "$$confirm" = "yes" ] || exit 1
	docker compose $(ALL_PROFILES) down -v
	sudo rm -rf data/mysql/* data/redis/* data/minio/*
	@echo "$(GREEN)✓ Data removed$(RESET)"

backup: ## Backup MySQL and Redis data
	@scripts/backup.sh

restore: ## Restore from backup  (usage: make restore FILE=backup.tar.gz)
	@[ -n "$(FILE)" ] || (echo "$(RED)Error: FILE is required. Usage: make restore FILE=backup.tar.gz$(RESET)" && exit 1)
	@scripts/restore.sh "$(FILE)"

##@ Package

install: ## Install public-services-containers system-wide
	@sudo scripts/install.sh

uninstall: ## Remove public-services-containers system-wide
	@sudo scripts/uninstall.sh

##@ Release

release: ## Bump patch version and release (triggers GitHub Actions)
	@scripts/release.sh patch

release-minor: ## Bump minor version and release
	@scripts/release.sh minor

release-major: ## Bump major version and release
	@scripts/release.sh major

release-dry: ## Preview next patch release (no changes made)
	@scripts/release.sh patch --dry-run

##@ Code Quality

lint: ## Run shellcheck on all shell scripts
	@if command -v shellcheck >/dev/null 2>&1; then \
		find scripts -name "*.sh" -exec shellcheck {} +; \
		shellcheck bin/pubservices completion/pubservices.bash; \
		echo "$(GREEN)✓ Shellcheck passed$(RESET)"; \
	else \
		echo "$(YELLOW)! shellcheck not installed — skipping$(RESET)"; \
	fi