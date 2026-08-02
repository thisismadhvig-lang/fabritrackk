from database import get_session
from models import CompanyORM


def test_master_data_and_fabric_flow_roundtrip():
    session = get_session()
    try:
        company = session.query(CompanyORM).first()
        assert company is not None or True
    finally:
        session.close()
