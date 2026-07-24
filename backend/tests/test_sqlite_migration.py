from fastapi.testclient import TestClient

from server import app


def test_app_starts_and_auth_endpoint_is_available():
    client = TestClient(app)
    response = client.get('/api/')
    assert response.status_code == 200
    assert response.json()['status'] == 'ok'
