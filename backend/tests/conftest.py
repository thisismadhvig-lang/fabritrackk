import sys
from pathlib import Path
from uuid import uuid4

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from database import SessionLocal
from models import CompanyORM, MaterialDispatchORM, MaterialInventoryORM, PayableORM, PaymentTransactionORM, ReceivableORM, VendorORM
from server import clear_test_company_id, set_test_company_id


@pytest.fixture(autouse=True)
def reset_material_test_data():
    company_id = f"company-test-{uuid4().hex[:8]}"
    set_test_company_id(company_id)

    with SessionLocal() as session:
        company = session.query(CompanyORM).filter(CompanyORM.id == company_id).first()
        if company is None:
            session.add(CompanyORM(
                id=company_id,
                name="Test Company",
                code=f"test-{uuid4().hex[:8]}",
                address="",
                contact_email="",
                contact_phone="",
            ))
        models = [
            PaymentTransactionORM,
            ReceivableORM,
            PayableORM,
            MaterialDispatchORM,
            MaterialInventoryORM,
            VendorORM,
        ]
        for model in models:
            session.query(model).filter(getattr(model, "company_id") == company_id).delete(synchronize_session=False)
        session.commit()

    yield

    with SessionLocal() as session:
        models = [
            PaymentTransactionORM,
            ReceivableORM,
            PayableORM,
            MaterialDispatchORM,
            MaterialInventoryORM,
            VendorORM,
        ]
        for model in models:
            session.query(model).filter(getattr(model, "company_id") == company_id).delete(synchronize_session=False)
        session.commit()

    clear_test_company_id()
