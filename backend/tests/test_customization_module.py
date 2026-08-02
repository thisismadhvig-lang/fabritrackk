import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from models import AppSettingORM


def test_app_settings_support_customization_payload():
    row = AppSettingORM(
        key="app",
        app_name="Test ERP",
        customization_data='{"modules": []}',
    )

    assert row.customization_data == '{"modules": []}'
