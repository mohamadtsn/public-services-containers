#!/bin/bash
# scripts/release.sh
# Automates the release process: bump version, commit, tag, push.
#
# Usage:
#   ./scripts/release.sh              # patch bump (default)
#   ./scripts/release.sh patch        # 1.0.3 → 1.0.4
#   ./scripts/release.sh minor        # 1.0.3 → 1.1.0
#   ./scripts/release.sh major        # 1.0.3 → 2.0.0
#   ./scripts/release.sh 1.2.0        # set exact version
#   ./scripts/release.sh patch --dry-run
#   ./scripts/release.sh patch --no-push

set -e

COLOR_RED='\033[1;31m'
COLOR_GREEN='\033[1;32m'
COLOR_YELLOW='\033[1;33m'
COLOR_BLUE='\033[1;34m'
COLOR_CYAN='\033[1;36m'
COLOR_WHITE='\033[1;37m'
COLOR_DIM='\033[2m'
COLOR_BOLD='\033[1m'
COLOR_RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
VERSION_FILE="${BASE_DIR}/VERSION"

# ─── Argument parsing ──────────────────────────────────────────────────────────

BUMP="patch"
DRY_RUN=false
NO_PUSH=false
NO_LINT=false

for arg in "$@"; do
    case "$arg" in
        patch|minor|major) BUMP="$arg" ;;
        --dry-run)  DRY_RUN=true ;;
        --no-push)  NO_PUSH=true ;;
        --no-lint)  NO_LINT=true ;;
        --help|-h)
            echo ""
            echo -e "  ${COLOR_WHITE}release.sh${COLOR_RESET}  —  Automate the release process"
            echo ""
            echo -e "  ${COLOR_BOLD}Usage:${COLOR_RESET}"
            echo -e "    ./scripts/release.sh [patch|minor|major|<version>] [options]"
            echo ""
            echo -e "  ${COLOR_BOLD}Bump types:${COLOR_RESET}"
            echo -e "    ${COLOR_CYAN}patch${COLOR_RESET}      1.0.3 → 1.0.4  ${COLOR_DIM}(default)${COLOR_RESET}"
            echo -e "    ${COLOR_CYAN}minor${COLOR_RESET}      1.0.3 → 1.1.0"
            echo -e "    ${COLOR_CYAN}major${COLOR_RESET}      1.0.3 → 2.0.0"
            echo -e "    ${COLOR_CYAN}<x.y.z>${COLOR_RESET}    set exact version"
            echo ""
            echo -e "  ${COLOR_BOLD}Options:${COLOR_RESET}"
            echo -e "    ${COLOR_CYAN}--dry-run${COLOR_RESET}  Show what would happen, make no changes"
            echo -e "    ${COLOR_CYAN}--no-push${COLOR_RESET}  Commit and tag locally, do not push"
            echo -e "    ${COLOR_CYAN}--no-lint${COLOR_RESET}  Skip shellcheck before releasing"
            echo ""
            exit 0
            ;;
        [0-9]*.*.*) BUMP="$arg" ;;
        *)
            echo -e "${COLOR_RED}  ✗  Unknown argument: $arg${COLOR_RESET}"
            echo -e "  Run with --help for usage."
            exit 1
            ;;
    esac
done

# ─── Helpers ───────────────────────────────────────────────────────────────────

step()  { echo -e "${COLOR_BLUE}  ›  ${1}${COLOR_RESET}"; }
ok()    { echo -e "${COLOR_GREEN}  ✓  ${1}${COLOR_RESET}"; }
warn()  { echo -e "${COLOR_YELLOW}  ⚠  ${1}${COLOR_RESET}"; }
fail()  { echo -e "${COLOR_RED}  ✗  ${1}${COLOR_RESET}" >&2; exit 1; }
dry()   { echo -e "${COLOR_DIM}  ~  [dry-run] ${1}${COLOR_RESET}"; }

run() {
    if $DRY_RUN; then
        dry "$*"
    else
        eval "$*"
    fi
}

# ─── Version bump logic ────────────────────────────────────────────────────────

current_version() {
    tr -d '[:space:]' < "$VERSION_FILE"
}

bump_version() {
    local current="$1"
    local bump="$2"

    if [[ ! "$current" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        fail "VERSION file contains invalid semver: '$current'"
    fi

    local major minor patch
    IFS='.' read -r major minor patch <<< "$current"

    case "$bump" in
        major) echo "$((major + 1)).0.0" ;;
        minor) echo "${major}.$((minor + 1)).0" ;;
        patch) echo "${major}.${minor}.$((patch + 1))" ;;
        *)
            if [[ ! "$bump" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                fail "Invalid version format: '$bump' — expected x.y.z"
            fi
            echo "$bump"
            ;;
    esac
}

# ─── Pre-flight checks ─────────────────────────────────────────────────────────

preflight() {
    step "Running pre-flight checks..."

    if ! git -C "$BASE_DIR" rev-parse --git-dir &>/dev/null; then
        fail "Not a git repository: $BASE_DIR"
    fi

    local branch
    branch=$(git -C "$BASE_DIR" rev-parse --abbrev-ref HEAD)
    if [[ "$branch" != "master" ]]; then
        fail "You must be on the 'master' branch to release. Current branch: $branch"
    fi

    if ! git -C "$BASE_DIR" diff --quiet || ! git -C "$BASE_DIR" diff --cached --quiet; then
        fail "Working tree has uncommitted changes. Commit or stash them first."
    fi

    if ! $NO_PUSH && ! $DRY_RUN; then
        if ! git -C "$BASE_DIR" ls-remote origin &>/dev/null; then
            fail "Cannot reach remote 'origin'. Check your connection or use --no-push."
        fi
    fi

    ok "Pre-flight checks passed"
}

# ─── Lint ──────────────────────────────────────────────────────────────────────

run_lint() {
    if $NO_LINT; then
        warn "Skipping lint (--no-lint)"
        return
    fi

    step "Running shellcheck..."
    if ! command -v shellcheck &>/dev/null; then
        warn "shellcheck not installed — skipping lint"
        return
    fi

    if shellcheck "${BASE_DIR}/bin/pubservices" "${BASE_DIR}/scripts/"*.sh 2>&1; then
        ok "Shellcheck passed"
    else
        fail "Shellcheck found issues. Fix them or use --no-lint to skip."
    fi
}

# ─── Main release flow ─────────────────────────────────────────────────────────

main() {
    local current new_version tag

    current=$(current_version)
    new_version=$(bump_version "$current" "$BUMP")
    tag="v${new_version}"

    echo ""
    echo -e "  ${COLOR_CYAN}╭─ Release ─────────────────────────────────────────────╮${COLOR_RESET}"
    echo -e "  ${COLOR_CYAN}│${COLOR_RESET}"
    echo -e "  ${COLOR_CYAN}│${COLOR_RESET}  ${COLOR_DIM}Current:${COLOR_RESET}  ${COLOR_WHITE}${current}${COLOR_RESET}"
    echo -e "  ${COLOR_CYAN}│${COLOR_RESET}  ${COLOR_DIM}New:${COLOR_RESET}      ${COLOR_GREEN}${new_version}${COLOR_RESET}  →  ${COLOR_CYAN}${tag}${COLOR_RESET}"
    echo -e "  ${COLOR_CYAN}│${COLOR_RESET}  ${COLOR_DIM}Push:${COLOR_RESET}     $( $NO_PUSH  && echo "no (--no-push)"  || echo "yes → GitHub Actions will create release" )"
    echo -e "  ${COLOR_CYAN}│${COLOR_RESET}  ${COLOR_DIM}Dry run:${COLOR_RESET}  $( $DRY_RUN && echo "${COLOR_YELLOW}yes — no changes will be made${COLOR_RESET}" || echo "no" )"
    echo -e "  ${COLOR_CYAN}│${COLOR_RESET}"
    echo -e "  ${COLOR_CYAN}╰───────────────────────────────────────────────────────╯${COLOR_RESET}"
    echo ""

    if ! $DRY_RUN; then
        read -r -p "  Proceed with release? [y/N]: " confirm
        [[ "${confirm:-n}" =~ ^[Yy]$ ]] || { echo -e "\n  ${COLOR_YELLOW}Cancelled.${COLOR_RESET}\n"; exit 0; }
        echo ""
    fi

    preflight
    run_lint

    step "Updating VERSION file: ${current} → ${new_version}"
    run "echo '${new_version}' > '${VERSION_FILE}'"

    step "Creating release commit..."
    run "git -C '${BASE_DIR}' add '${VERSION_FILE}'"
    run "git -C '${BASE_DIR}' commit -m 'Release ${tag}'"

    step "Creating tag ${tag}..."
    run "git -C '${BASE_DIR}' tag '${tag}'"

    if $NO_PUSH; then
        warn "Skipping push (--no-push). To push later:"
        echo -e "    git push origin master && git push origin ${tag}"
    else
        step "Pushing commit and tag to origin..."
        run "git -C '${BASE_DIR}' push origin master"
        run "git -C '${BASE_DIR}' push origin '${tag}'"
    fi

    echo ""
    if $DRY_RUN; then
        echo -e "  ${COLOR_YELLOW}Dry run complete — no changes were made.${COLOR_RESET}"
    else
        ok "Release ${tag} complete!"
        if ! $NO_PUSH; then
            echo -e "  ${COLOR_DIM}GitHub Actions is now creating the release.${COLOR_RESET}"
            echo -e "  ${COLOR_DIM}Watch: https://github.com/mohamadtsn/public-services-containers/actions${COLOR_RESET}"
        fi
    fi
    echo ""
}

main
