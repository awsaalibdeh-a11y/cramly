"""Email + password accounts: sign up, sign in, forgot password (owner approves in the panel), reset."""

import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DATABASE_URL", f"sqlite:///{os.path.join(tempfile.mkdtemp(), 'acct.db')}")
os.environ.setdefault("OPENAI_API_KEY", "test")

import app as server  # noqa: E402

ADMIN = {"X-Admin-Key": "a-long-private-passphrase"}


class Accounts(unittest.TestCase):
    def setUp(self):
        self.c = server.app.test_client()
        server._hits.clear()
        self.env = mock.patch.dict(os.environ, {"ADMIN_KEY": "a-long-private-passphrase"}); self.env.start()

    def tearDown(self):
        self.env.stop()

    def signup(self, email="sam@example.com", pw="goodpass42", **kw):
        return self.c.post("/api/uni/acct/signup", json={"email": email, "password": pw, "app": "void"}, **kw)

    def test_signup_login_me(self):
        r = self.signup("Sam@Example.com")
        self.assertEqual(r.status_code, 201); key = r.get_json()["key"]
        self.assertEqual(r.get_json()["email"], "sam@example.com")
        me = self.c.get("/api/uni/acct/me", headers={"Authorization": "Bearer " + key}).get_json()
        self.assertEqual(me["email"], "sam@example.com")
        self.assertEqual(self.signup().status_code, 409)                                   # the same email twice
        self.assertEqual(self.c.post("/api/uni/acct/login", json={"email": "sam@example.com", "password": "nope-nope"}).status_code, 401)
        ok = self.c.post("/api/uni/acct/login", json={"email": "SAM@example.com", "password": "goodpass42", "app": "noor"})
        self.assertEqual(ok.status_code, 200); self.assertTrue(ok.get_json()["key"])
        # the guard knows the account in every app
        g = self.c.get("/api/uni/guard?app=void", headers={"Authorization": "Bearer " + ok.get_json()["key"]}).get_json()
        self.assertTrue(g["linked"])

    def test_bad_input(self):
        self.assertEqual(self.signup("not-an-email").status_code, 400)
        self.assertEqual(self.signup("a@b.co", "short").status_code, 400)
        self.assertEqual(self.signup("a@b.co", "12345678").status_code, 400)

    def test_owner_sees_emails_never_passwords(self):
        self.signup("lee@example.com", "secretpass9")
        d = self.c.get("/api/admin/acct", headers=ADMIN).get_json()
        row = next(a for a in d["accounts"] if a["email"] == "lee@example.com")
        self.assertIn("void", row["apps"])
        self.assertNotIn("secretpass9", str(d)); self.assertNotIn("pw_hash", str(d))
        self.assertEqual(self.c.get("/api/admin/acct").status_code, 403)                    # not without the owner key

    def test_forgot_password_needs_the_owner(self):
        self.signup("kim@example.com", "firstpass1")
        f = self.c.post("/api/uni/acct/forgot", json={"email": "kim@example.com"}).get_json()
        t = f["ticket"]
        self.assertEqual(self.c.get(f"/api/uni/acct/forgot?ticket={t}").get_json()["status"], "pending")
        self.assertEqual(self.c.post("/api/uni/acct/reset", json={"ticket": t, "password": "newpass123"}).status_code, 403)   # not yet approved
        req = next(x for x in self.c.get("/api/admin/acct", headers=ADMIN).get_json()["resets"] if x["code"] == f["code"])
        self.assertEqual(self.c.post(f"/api/admin/acct/reset/{req['id']}", json={"approve": True}, headers=ADMIN).status_code, 200)
        self.assertEqual(self.c.get(f"/api/uni/acct/forgot?ticket={t}").get_json()["status"], "approved")
        r = self.c.post("/api/uni/acct/reset", json={"ticket": t, "password": "newpass123"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.c.post("/api/uni/acct/login", json={"email": "kim@example.com", "password": "newpass123"}).status_code, 200)
        self.assertEqual(self.c.post("/api/uni/acct/login", json={"email": "kim@example.com", "password": "firstpass1"}).status_code, 401)
        self.assertEqual(self.c.post("/api/uni/acct/reset", json={"ticket": t, "password": "another123"}).status_code, 403)   # one use only

    def test_denied_reset(self):
        self.signup("jo@example.com", "firstpass1")
        f = self.c.post("/api/uni/acct/forgot", json={"email": "jo@example.com"}).get_json()
        req = next(x for x in self.c.get("/api/admin/acct", headers=ADMIN).get_json()["resets"] if x["code"] == f["code"])
        self.c.post(f"/api/admin/acct/reset/{req['id']}", json={"approve": False}, headers=ADMIN)
        self.assertEqual(self.c.get(f"/api/uni/acct/forgot?ticket={f['ticket']}").get_json()["status"], "denied")
        self.assertEqual(self.c.post("/api/uni/acct/reset", json={"ticket": f["ticket"], "password": "newpass123"}).status_code, 403)
        self.assertEqual(self.c.post("/api/uni/acct/forgot", json={"email": "nobody@example.com"}).status_code, 404)


if __name__ == "__main__":
    unittest.main()
