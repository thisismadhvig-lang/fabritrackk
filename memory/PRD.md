# LOOMLINE — Garment Manufacturing & Inventory ERP

## Original problem statement
Men's garment company (wholesale local + export). Track fabric (kg) coming in, distribute to own factory or third-party manufacturers, follow 14-stage manufacturing pipeline, capture pieces returned and defects, compute average fabric per piece.

Workflow: Order Received → Sampling → Buyer Approval → Fabric Purchase → Fabric Received → Cutting → Printing → Stitching → Washing → Finishing → Quality Check → Packing → Warehouse → Shipment

## User choices (from ask_human)
- Single user, no authentication
- All 5 modules: Fabric Inventory, Production Tracking, Product Inventory, Orders & Buyers, Third-party manufacturer tracking
- Dashboards with charts
- Configurable product types
- Professional industrial dashboard design

## User persona
Owner-operator of a small-to-mid garment factory. Data-heavy, operational focus. Prefers dense tables + hard status indicators.

## Architecture
- FastAPI backend, MongoDB, all routes under `/api`
- React 19 SPA, react-router, Shadcn UI, Recharts, sonner toasts
- Sidebar layout (240px) + KPI strip + data grids
- Fonts: Outfit (headings) + IBM Plex Sans (body)

## Data models (all UUID string IDs)
- Buyer (name, contact, country, type=local|export)
- ProductType (name, avg_fabric_per_piece_kg, description)
- Vendor (name, type=own|third_party, contact, location)
- FabricLot (fabric_type, color, supplier, kg_received, cost_per_kg, date_received)
- FabricDispatch (fabric_lot_id, vendor_id, order_id?, kg_dispatched, date)
- Order (order_number, buyer_id, product_type_id, quantity, stage, order_date, delivery_date)
- ProductionReturn (vendor_id, order_id?, product_type_id, pieces_received, pieces_defected, kg_used, date)

## Implemented (2026-02-15)
- Backend CRUD for all 7 entities + validated dispatch (kg cap) + stage transitions
- `/api/dashboard/summary` aggregates KPIs, vendor stats, fabric-by-type, product mix, stage funnel
- 9 frontend pages: Dashboard, Fabric Inventory, Fabric Dispatch, Production, Returns & QC, Orders, Buyers, Vendors, Product Types
- Dashboard with 8 KPI cards, 4 charts (bar/pie), live from backend
- Production page shows 14-stage progress dots per order with in-place stage change
- Testing agent iteration 1: backend 100%, frontend 95% — all core flows pass

## Implemented (2026-02-16 · Expansion)
- **Job Work Ledger** (`/ledger`, GET `/api/vendors/{id}/ledger`): per-vendor 10-metric summary (fabric received, consumed, lying, pieces produced, avg kg/piece, pieces pending, defected, returned, cutting waste, job work payable) + unified transaction history
- **Fabric Reconciliation** (`/reconciliation`, GET `/api/orders/{id}/reconciliation`): per-order fabric flow (issued/consumed/returned/waste/unaccounted) + Piece Cost Calculator (weighted avg fabric rate, fabric cost, job work cost, cost per piece, margin, expected revenue) + unaccounted-loss warning card
- **Extended Dashboard** (GET `/api/dashboard/extended`): Today's Activity (production/dispatch/receipts), Operational Snapshot (pending/delayed/warehouse/fabric-available/fabric-at-3rd-party/efficiency), Monthly (sales + export)
- **CSV Import** for fabric lots and orders (auto-creates missing buyers/products) with sample CSV download
- Order model gained `unit_price`; ProductionReturn gained `fabric_returned_kg`, `cutting_waste_kg`, `job_work_rate_per_piece`
- Testing agent iteration 2: backend 100%, frontend 100% — math verified

## Implemented (2026-02-17 · Auth + Editability + Rename)
- **JWT authentication** (bcrypt + PyJWT, 30-day tokens): admin/admin seeded on startup, `POST /api/auth/login`, `GET /api/auth/me`, change-password, change-username
- **Login page** (`/login`) with "WELCOME! LET'S GET BACK TO WORK" heading, split-panel design
- **Auth middleware** protects all `/api/*` except `/`, `/api/auth/login`, and `GET /api/settings`
- **Edit + Archive** on every entity: `PATCH /api/{coll}/{id}` for updates, `PATCH /api/{coll}/{id}/archive` for soft-delete. All list GETs accept `?include_archived=true`. Frontend shows Pencil (edit) + Archive icons per row + "Show archived" Switch
- **product_type_id** added to FabricDispatch (backend model, form select, table column showing product badge)
- **Configurable app name** via Settings page: `PATCH /api/settings` updates `app_name` + `tagline`; sidebar reflects live via AuthContext
- **Settings page** (`/settings`): rebrand app, change password, change username (with current-password confirmation)
- Testing agent iteration 3: backend 100% (38/38 pytest), frontend 100% — all flows verified end-to-end

## Implemented (2026-02-17 · Code Review Fixes)
- **Security**: JWT moved from localStorage → httpOnly Secure SameSite=Lax cookie (`loomline_token`, 30-day Max-Age). No auth data in browser storage. `/api/auth/logout` endpoint clears cookie with matching attributes. Bearer token still accepted for backwards-compat / API testing
- **CORS**: switched from `allow_origins=['*']` to `allow_origin_regex='.*'` so `allow_credentials=True` works cross-origin (browsers reject `*` with credentials)
- **Backend refactor**: `dashboard_summary`, `dashboard_extended`, `vendor_ledger`, `order_reconciliation` split into 15 small single-responsibility helpers (`_load_active`, `_fabric_totals`, `_vendor_stats`, `_fabric_by_type`, `_product_stats`, `_stage_funnel`, `_todays_activity`, `_order_status`, `_fabric_location`, `_quality_metrics`, `_monthly_revenue`, `_ledger_summary`, `_pending_pieces`, `_ledger_txns`, `_reconciliation_metrics`, `_avg_fabric_cost`, `_piece_costing`)
- **React hooks**: fixed missing deps in `AuthProvider` (useCallback + useMemo on value), `Login`, `Ledger`, `Reconciliation`. Removed all `eslint-disable-next-line` markers. Dashboard chart configs extracted to module-level constants; PieChart Cells keyed by `entry.product`; CsvImportButton errors keyed by error string; FabricDispatch `availableLots` wrapped in `useMemo`
- Testing agent iteration 4: 42/42 new tests + 38/38 regression pass, 0 hook warnings, 0 key warnings in browser

## Backlog (deferred)
- P1: Vendor-level performance report (defect rate per vendor over time)
- P1: Import/export data (CSV upload for fabric lots, orders)
- P2: Cost per finished piece calculation (fabric cost + labour)
- P2: Multi-user roles (Admin/Manager/Worker) with JWT auth
- P2: Shipment tracking + invoice generation
- P2: Low-stock alerts when fabric remaining crosses threshold
