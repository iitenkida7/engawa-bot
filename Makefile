# engawa-bot task runner — everything runs through Docker.

COMPOSE := docker compose
DEV := $(COMPOSE) run --rm dev

.PHONY: up down restart logs ps build install typecheck lint test clean

up:
	$(COMPOSE) up -d --build bot

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) down
	$(COMPOSE) up -d --build bot

logs:
	$(COMPOSE) logs -f bot

ps:
	$(COMPOSE) ps

build:
	$(COMPOSE) build

install:
	$(DEV) bun install --frozen-lockfile

typecheck:
	$(DEV) bun run typecheck

lint:
	$(DEV) bun run lint

test:
	$(DEV) bun test

clean:
	$(COMPOSE) down -v
