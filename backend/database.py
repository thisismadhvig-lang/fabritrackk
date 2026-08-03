import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from models import Base, FabricDispatchORM, MaterialAdjustmentORM, OrderItemORM, OrderORM, PartyLedgerEntryORM, PartyORM, ProductionReturnORM, ShipmentORM, ShipmentProductORM

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is required")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def ensure_schema() -> None:
    init_db()
    with engine.begin() as conn:
        inspector = inspect(conn)
        existing_tables = set(inspector.get_table_names())
        if "material_adjustments" not in existing_tables:
            MaterialAdjustmentORM.__table__.create(bind=conn)
        if "party_ledger_entries" not in existing_tables:
            PartyLedgerEntryORM.__table__.create(bind=conn)
        if "shipments" not in existing_tables:
            ShipmentORM.__table__.create(bind=conn)
        if "shipment_products" not in existing_tables:
            ShipmentProductORM.__table__.create(bind=conn)
        if "order_items" not in existing_tables:
            OrderItemORM.__table__.create(bind=conn)

        shipments_columns = {column["name"] for column in inspector.get_columns("shipments")}
        for column_name, column_def in {
            "order_id": "VARCHAR DEFAULT ''",
            "order_number": "VARCHAR DEFAULT ''",
            "buyer_name": "VARCHAR DEFAULT ''",
            "brand": "VARCHAR DEFAULT ''",
            "order_date": "TIMESTAMP",
            "delivery_date": "TIMESTAMP",
            "order_quantity": "INTEGER DEFAULT 0",
            "warehouse_available_quantity": "INTEGER DEFAULT 0",
            "po_no": "VARCHAR DEFAULT ''",
            "transport_mode": "VARCHAR DEFAULT ''",
            "transporter": "VARCHAR DEFAULT ''",
            "driver_name": "VARCHAR DEFAULT ''",
            "courier": "VARCHAR DEFAULT ''",
            "tracking_number": "VARCHAR DEFAULT ''",
            "e_way_bill": "VARCHAR DEFAULT ''",
            "packing_list_no": "VARCHAR DEFAULT ''",
            "number_of_cartons": "INTEGER DEFAULT 0",
            "gross_weight": "FLOAT DEFAULT 0.0",
            "net_weight": "FLOAT DEFAULT 0.0",
        }.items():
            if column_name not in shipments_columns:
                conn.execute(text(f"ALTER TABLE shipments ADD COLUMN {column_name} {column_def}"))

        shipment_products_columns = {column["name"] for column in inspector.get_columns("shipment_products")}
        for column_name, column_def in {
            "order_id": "VARCHAR DEFAULT ''",
            "order_number": "VARCHAR DEFAULT ''",
            "fabric": "VARCHAR DEFAULT ''",
            "size": "VARCHAR DEFAULT ''",
            "warehouse_available_quantity": "INTEGER DEFAULT 0",
        }.items():
            if column_name not in shipment_products_columns:
                conn.execute(text(f"ALTER TABLE shipment_products ADD COLUMN {column_name} {column_def}"))

        try:
            conn.execute(text("DROP INDEX IF EXISTS ix_shipments_shipment_no"))
        except Exception:
            pass

        if "parties" in existing_tables:
            parties_columns = {column["name"] for column in inspector.get_columns("parties")}
            for column_name, column_def in {
                "contact_name": "VARCHAR DEFAULT ''",
                "phone": "VARCHAR DEFAULT ''",
                "tax_number": "VARCHAR DEFAULT ''",
                "address": "TEXT DEFAULT ''",
                "email": "VARCHAR DEFAULT ''",
                "remarks": "TEXT DEFAULT ''",
                "opening_balance": "FLOAT DEFAULT 0.0",
                "archived": "BOOLEAN DEFAULT FALSE",
            }.items():
                if column_name not in parties_columns:
                    conn.execute(text(f"ALTER TABLE parties ADD COLUMN {column_name} {column_def}"))

        payables_columns = {column["name"] for column in inspector.get_columns("payables")}
        for column_name, column_def in {
            "original_job_work_amount": "FLOAT DEFAULT 0.0",
            "total_material_adjustment": "FLOAT DEFAULT 0.0",
            "net_payable_amount": "FLOAT DEFAULT 0.0",
            "outstanding_balance": "FLOAT DEFAULT 0.0",
        }.items():
            if column_name not in payables_columns:
                conn.execute(text(f"ALTER TABLE payables ADD COLUMN {column_name} {column_def}"))

        production_returns_columns = {column["name"] for column in inspector.get_columns("production_returns")}
        for column_name, column_def in {
            "fabric_consumed_kg": "FLOAT DEFAULT 0.0",
            "challan_no": "VARCHAR DEFAULT ''",
            "lot_no": "VARCHAR DEFAULT ''",
            "article_barcode": "VARCHAR DEFAULT ''",
            "expected_pieces": "FLOAT DEFAULT 0.0",
            "avg_fabric_per_piece": "FLOAT DEFAULT 0.0",
            "fabric_still_lying_kg": "FLOAT DEFAULT 0.0",
        }.items():
            if column_name not in production_returns_columns:
                conn.execute(text(f"ALTER TABLE production_returns ADD COLUMN {column_name} {column_def}"))

        fabric_dispatches_columns = {column["name"] for column in inspector.get_columns("fabric_dispatches")}
        for column_name, column_def in {
            "expected_pieces": "FLOAT DEFAULT 0.0",
        }.items():
            if column_name not in fabric_dispatches_columns:
                conn.execute(text(f"ALTER TABLE fabric_dispatches ADD COLUMN {column_name} {column_def}"))

        orders_columns = {column["name"] for column in inspector.get_columns("orders")}
        for column_name, column_def in {
            "order_status": "VARCHAR DEFAULT 'Confirmed'",
            "order_type": "VARCHAR DEFAULT 'local'",
            "payment_terms": "VARCHAR DEFAULT ''",
            "currency": "VARCHAR DEFAULT 'INR'",
            "subtotal": "FLOAT DEFAULT 0.0",
            "discount": "FLOAT DEFAULT 0.0",
            "tax": "FLOAT DEFAULT 0.0",
            "grand_total": "FLOAT DEFAULT 0.0",
        }.items():
            if column_name not in orders_columns:
                conn.execute(text(f"ALTER TABLE orders ADD COLUMN {column_name} {column_def}"))


def get_session():
    return SessionLocal()
