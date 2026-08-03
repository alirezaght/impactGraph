from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_list_deals() -> None:
    response = client.get("/deals/")
    assert response.status_code == 200
    assert response.json()[0]["id"] == "d1"
