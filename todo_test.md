# Todo App — Build Plan

A full-featured todo application with a **FastAPI** (Python) backend and **React** (TypeScript) frontend. Designed to exercise multiple coding factory roles in parallel.

---

## Tech Stack

### Backend
- **Framework:** FastAPI
- **Database:** SQLite via SQLAlchemy (async with aiosqlite)
- **Migrations:** Alembic
- **Validation:** Pydantic v2
- **Testing:** pytest + httpx (async)

### Frontend
- **UI:** React 18, TypeScript, Tailwind CSS
- **State:** Zustand
- **HTTP:** axios
- **Testing:** Vitest + React Testing Library
- **Build:** Vite

---

## Data Model

### Backend (SQLAlchemy)

```python
class Todo(Base):
    __tablename__ = "todos"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: str(uuid4()))
    title: Mapped[str]
    description: Mapped[str] = mapped_column(default="")
    completed: Mapped[bool] = mapped_column(default=False)
    priority: Mapped[str] = mapped_column(default="medium")  # low | medium | high | urgent
    due_date: Mapped[datetime | None]
    position: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)

    tags: Mapped[list["Tag"]] = relationship(secondary=todo_tags, back_populates="todos")
    subtasks: Mapped[list["Subtask"]] = relationship(cascade="all, delete-orphan")
    recurring_rule: Mapped["RecurringRule | None"] = relationship(uselist=False, cascade="all, delete-orphan")


class Subtask(Base):
    __tablename__ = "subtasks"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: str(uuid4()))
    todo_id: Mapped[str] = mapped_column(ForeignKey("todos.id"))
    title: Mapped[str]
    completed: Mapped[bool] = mapped_column(default=False)


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(unique=True)
    color: Mapped[str] = mapped_column(default="#6b7280")

    todos: Mapped[list["Todo"]] = relationship(secondary=todo_tags, back_populates="tags")


class RecurringRule(Base):
    __tablename__ = "recurring_rules"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: str(uuid4()))
    todo_id: Mapped[str] = mapped_column(ForeignKey("todos.id"))
    frequency: Mapped[str]  # daily | weekly | monthly
    interval: Mapped[int] = mapped_column(default=1)
```

### Frontend (TypeScript)

```ts
interface Todo {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  priority: "low" | "medium" | "high" | "urgent";
  tags: Tag[];
  subtasks: Subtask[];
  due_date: string | null;
  recurring_rule: RecurringRule | null;
  position: number;
  created_at: string;
  updated_at: string;
}

interface Subtask { id: string; title: string; completed: boolean }
interface Tag { id: string; name: string; color: string }
interface RecurringRule { frequency: string; interval: number }
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/todos` | List todos (query params: `search`, `priority`, `status`, `tag`, `sort_by`, `order`, `limit`, `offset`) |
| `POST` | `/api/todos` | Create todo |
| `GET` | `/api/todos/{id}` | Get single todo |
| `PATCH` | `/api/todos/{id}` | Update todo fields |
| `DELETE` | `/api/todos/{id}` | Delete todo |
| `POST` | `/api/todos/{id}/complete` | Toggle completion (triggers recurring generation) |
| `POST` | `/api/todos/bulk` | Bulk action: `{ action: "complete" \| "delete" \| "set_priority", ids: [], priority?: str }` |
| `PATCH` | `/api/todos/reorder` | Reorder: `{ ordered_ids: [] }` |
| `GET` | `/api/todos/{id}/subtasks` | List subtasks |
| `POST` | `/api/todos/{id}/subtasks` | Add subtask |
| `PATCH` | `/api/subtasks/{id}` | Update subtask |
| `DELETE` | `/api/subtasks/{id}` | Delete subtask |
| `GET` | `/api/tags` | List all tags |
| `GET` | `/api/stats` | Dashboard stats (completion rate, by priority, overdue count, streak) |
| `GET` | `/api/export` | Export all todos as JSON |
| `POST` | `/api/import` | Import todos from JSON (body: `{ mode: "merge" \| "replace", data: [] }`) |

---

## Features

### Phase 1 — Core CRUD & API

1. **FastAPI project scaffold** — app factory, router registration, async SQLAlchemy session, Alembic init
2. **Todo CRUD endpoints** — create, read, update, delete with Pydantic request/response schemas
3. **Subtask endpoints** — nested CRUD under a todo
4. **Tag system** — create-on-write (tags created implicitly when attached to a todo), list, color assignment
5. **React scaffold** — Vite + TypeScript + Tailwind, axios client, proxy to backend
6. **Todo list UI** — fetch and render todos, create form dialog, inline edit, delete with confirmation
7. **Subtask UI** — expandable subtask list within each todo item

### Phase 2 — Filtering, Search & Organization

8. **Server-side filtering** — query params for priority, status, tag; full-text search on title + description
9. **Sort** — sort by due date, priority, created date, title; asc/desc toggle
10. **Filter bar component** — dropdowns for priority/status, tag chips, search input with debounce
11. **Tag management UI** — autocomplete, color-coded chips, tag cloud in sidebar
12. **Bulk actions** — multi-select with checkboxes; toolbar for complete/delete/set-priority
13. **Drag-and-drop reorder** — `@dnd-kit/sortable`; persist position via `PATCH /reorder`

### Phase 3 — Advanced Features

14. **Recurring todos** — configure frequency on create/edit; on completion, API auto-generates next instance
15. **Due date warnings** — overdue (red), due today (amber), due this week (blue) badges
16. **Stats dashboard** — `/api/stats` endpoint; frontend widget with completion rate, priority breakdown, streak
17. **Undo support** — optimistic UI with rollback; toast with "Undo" button that reverts the last API call
18. **Keyboard shortcuts** — `n` new, `e` edit, `d` delete, `↑↓` navigate, `space` toggle, `?` help overlay
19. **Dark/light theme** — Tailwind `dark:` classes, system preference detection, persisted toggle

### Phase 4 — Polish & Production Readiness

20. **Import/export** — JSON download of all todos; upload with merge or replace
21. **Notifications** — browser Notification API for todos due within 1 hour (polling or frontend timer)
22. **Accessibility** — ARIA labels, focus management, keyboard nav, screen reader announcements
23. **Responsive layout** — mobile-first; collapsible sidebar on small screens
24. **Empty states** — distinct illustrations for no todos, no results, all complete
25. **Error handling** — global API error interceptor, toast notifications, retry on network failure
26. **CORS & security** — CORS middleware configured for frontend origin, input sanitization

---

## Project Structure

```
todo-app/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app factory, middleware, lifespan
│   │   ├── config.py            # Settings via pydantic-settings
│   │   ├── database.py          # Async engine, session factory
│   │   ├── models.py            # SQLAlchemy models
│   │   ├── schemas.py           # Pydantic request/response schemas
│   │   ├── routers/
│   │   │   ├── todos.py
│   │   │   ├── subtasks.py
│   │   │   ├── tags.py
│   │   │   └── stats.py
│   │   └── services/
│   │       ├── todo_service.py  # Business logic, recurring generation
│   │       └── stats_service.py
│   ├── alembic/
│   ├── alembic.ini
│   ├── requirements.txt
│   └── tests/
│       ├── conftest.py          # Async test client, in-memory DB fixture
│       ├── test_todos.py
│       ├── test_subtasks.py
│       ├── test_tags.py
│       └── test_stats.py
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── api/
│   │   │   └── client.ts        # Axios instance + typed API functions
│   │   ├── stores/
│   │   │   ├── todoStore.ts
│   │   │   ├── filterStore.ts
│   │   │   └── uiStore.ts
│   │   ├── components/
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── TodoList.tsx
│   │   │   ├── TodoItem.tsx
│   │   │   ├── TodoFormDialog.tsx
│   │   │   ├── SubtaskList.tsx
│   │   │   ├── FilterPanel.tsx
│   │   │   ├── BulkActionBar.tsx
│   │   │   ├── StatsWidget.tsx
│   │   │   ├── TagChips.tsx
│   │   │   ├── DueDateBadge.tsx
│   │   │   ├── PriorityBadge.tsx
│   │   │   ├── EmptyState.tsx
│   │   │   ├── ConfirmDialog.tsx
│   │   │   ├── ShortcutHelp.tsx
│   │   │   ├── ThemeToggle.tsx
│   │   │   └── UndoToast.tsx
│   │   ├── hooks/
│   │   │   ├── useTodos.ts
│   │   │   ├── useKeyboardShortcuts.ts
│   │   │   └── useNotifications.ts
│   │   └── types.ts
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── package.json
└── docker-compose.yml           # Backend + frontend for local dev
```

---

## Test Plan

### Backend (pytest)
- **Unit** — service layer: CRUD logic, recurring generation, stats calculation, bulk operations
- **API** — every endpoint: success, validation errors, 404s, edge cases (empty body, duplicate tags)
- **Integration** — full flows: create → add subtasks → complete → verify recurring clone → export → import

### Frontend (Vitest)
- **Component** — TodoItem renders per state, form validates required fields, filter panel updates store
- **Store** — each Zustand slice: state transitions, optimistic updates, rollback
- **Integration** — mock API: create → filter → bulk complete → undo → verify UI state
- **Accessibility** — axe-core checks on key views

### Edge Cases
- 1000+ todos pagination/scroll performance
- Concurrent edits (optimistic update conflicts)
- Malformed import JSON handling
- Network failure during bulk operation

---

## Coding Factory Role Assignments

| Role | Scope |
|------|-------|
| **Planner** | Break phases into tasks with acceptance criteria; maintain this plan |
| **Coder** | Implement backend services/routes, frontend components/stores/hooks |
| **Reviewer** | Review for type safety, SQL injection prevention, accessibility, API contract consistency |
| **Tester** | Write and run pytest + Vitest suites; report coverage gaps |

Each role runs in its own container with the shared `todo-app/` workspace.
