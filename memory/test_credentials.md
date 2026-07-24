# LOOMLINE Test Credentials

## Admin login
- **URL**: `/login`
- **Username**: `admin`
- **Password**: `admin`
- Role: full access (single-user ERP)

## Auth endpoints
- `POST /api/auth/login` — { username, password } → { access_token, user }
- `GET /api/auth/me` — Bearer token → { username }
- `POST /api/auth/change-password` — Bearer token, { current_password, new_password }
- `POST /api/auth/change-username` — Bearer token, { current_password, new_username } → new token

## App settings
- `GET /api/settings` — public, returns { app_name, tagline }
- `PATCH /api/settings` — Bearer token, updates app_name / tagline

## Notes
- JWT stored in browser localStorage under key `loomline_token`
- Token expiry: 30 days
- Every /api/* route except `/api/`, `/api/auth/login`, and `GET /api/settings` requires `Authorization: Bearer <token>` header
