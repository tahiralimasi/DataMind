import pandas as pd

from backend import app as backend_app


def test_ai_advisor_requires_dataset():
    backend_app.current_dataset = None
    client = backend_app.app.test_client()

    response = client.post('/api/ai/data-advisor', json={})

    assert response.status_code == 400
    assert 'dataset' in response.get_json()['error'].lower()


def test_ai_advisor_rejects_invalid_groq_json(monkeypatch):
    backend_app.current_dataset = pd.DataFrame({
        'customer_id': [1, 2, 3],
        'monthly_income': [5000, None, 7000],
        'segment': ['A', 'A', 'B'],
    })

    class FakeResponse:
        def __init__(self):
            self.choices = [type('Message', (), {'content': 'not-json'})()]

    def fake_call(*args, **kwargs):
        return FakeResponse()

    monkeypatch.setattr(backend_app, 'call_groq_for_dataset_advice', fake_call)
    client = backend_app.app.test_client()

    response = client.post('/api/ai/data-advisor', json={})

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is False
    assert payload['error'] == 'AI returned an invalid response'
