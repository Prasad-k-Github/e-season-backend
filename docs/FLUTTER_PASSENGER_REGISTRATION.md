# Flutter implementation guide: passenger registration

Backend: e_season REST API (`/api`). This guide covers everything the Flutter app needs to register a passenger:
phone OTP, the registration form with image uploads, error handling and what to show after sign-up.

## 1. Flow overview

```
[Phone screen] ──POST /auth/otp/request──► SMS code sent
[OTP screen]   ──POST /auth/otp/verify───►  registered:false  → registrationToken (30 min)
                                            registered:true   → token  (account exists → go to login/home)
[Details form] ──POST /register (multipart, Bearer registrationToken)──► 201 { token, verificationStatus, ... }
[Status screen]  shows "pending_verification" or "pending_institution_approval"
```

| Step | Token you hold | Token you get |
|---|---|---|
| OTP verify (new number) | none | `registrationToken` (valid 30 minutes) |
| Register | `registrationToken` | `token` (user token, valid 7 days) |

Keep `registrationToken` in memory only. Save the final user `token` in secure storage.

## 2. Setup

`pubspec.yaml`:

```yaml
dependencies:
  dio: ^5.4.0
  flutter_secure_storage: ^9.0.0
  image_picker: ^1.0.7
  http_parser: ^4.0.2        # for MediaType on uploads
  pinput: ^5.0.0             # optional, 6-digit OTP input
```

Base URL:

| Where the app runs | Base URL |
|---|---|
| Android emulator | `http://10.0.2.2:3000` |
| iOS simulator | `http://localhost:3000` |
| Real phone (same Wi-Fi) | `http://<your-PC-LAN-IP>:3000` (allow port 3000 in Windows Firewall) |

Android cleartext HTTP: add `android:usesCleartextTraffic="true"` to `<application>` in `AndroidManifest.xml` while developing.
Android also needs `<uses-permission android:name="android.permission.INTERNET"/>`.
iOS needs `NSPhotoLibraryUsageDescription` and `NSCameraUsageDescription` in `Info.plist` for `image_picker`.

## 3. API client

```dart
// lib/core/api_client.dart
import 'package:dio/dio.dart';

class ApiError implements Exception {
  final int? status;
  final String code;
  final String message;
  final Map<String, String> fieldErrors; // field name -> message (validation_error only)
  ApiError(this.status, this.code, this.message, [this.fieldErrors = const {}]);
  @override
  String toString() => message;
}

ApiError toApiError(DioException e) {
  final data = e.response?.data;
  if (data is Map && data['error'] is Map) {
    final err = data['error'] as Map;
    final fields = <String, String>{};
    for (final d in (err['details'] as List? ?? const [])) {
      fields[d['field'] as String] = d['message'] as String;
    }
    return ApiError(e.response?.statusCode, err['code'] ?? 'error', err['message'] ?? 'Request failed', fields);
  }
  if (e.type == DioExceptionType.connectionTimeout ||
      e.type == DioExceptionType.receiveTimeout ||
      e.type == DioExceptionType.connectionError) {
    return ApiError(null, 'network', 'Cannot reach the server. Check your connection.');
  }
  return ApiError(e.response?.statusCode, 'unknown', 'Something went wrong');
}

final dio = Dio(BaseOptions(
  baseUrl: 'http://10.0.2.2:3000/api',
  connectTimeout: const Duration(seconds: 15),
  receiveTimeout: const Duration(seconds: 30), // uploads can be slower
));
```

Every error body has this shape, so one parser covers all screens:

```json
{ "error": { "code": "validation_error", "message": "Invalid request data",
             "details": [ { "field": "nic", "message": "Invalid NIC. Use 9 digits + V/X, or 12 digits" } ] } }
```

`details` only appears for `validation_error`.

## 4. Step 1: request the OTP

`POST /auth/otp/request` (JSON, no auth)

```json
{ "phone": "0771234567" }
```

Phone formats accepted: `07XXXXXXXX`, `7XXXXXXXX`, `+947XXXXXXXX`, `947XXXXXXXX`. Sri Lankan mobiles only (`07…`).

Success `200`:

```json
{ "expiresInSeconds": 300 }
```

`devCode` is also returned only when the server runs with `OTP_PROVIDER=mock` and is not in production. Never depend on it in the app.

| Status | `code` | Show |
|---|---|---|
| 400 | `bad_phone` | "Enter a valid mobile number (07XXXXXXXX)" |
| 429 | `otp_cooldown` | "Please wait a minute before requesting another code" (start a 60 s resend timer) |
| 429 | (rate limit) | "Too many requests. Try again later." (10 requests per hour per IP) |
| 502 | `sms_failed` | "We couldn't send the SMS. Try again shortly." |

```dart
Future<int> requestOtp(String phone) async {
  try {
    final r = await dio.post('/auth/otp/request', data: {'phone': phone});
    return r.data['expiresInSeconds'] as int;
  } on DioException catch (e) {
    throw toApiError(e);
  }
}
```

UI: phone field, "Send code" button, then navigate to the OTP screen. Run a 60 s countdown on the resend button, matching the server cooldown.

## 5. Step 2: verify the OTP

`POST /auth/otp/verify` (JSON, no auth)

```json
{ "phone": "0771234567", "code": "123456" }
```

The code is exactly 6 digits. Two possible `200` responses, so branch on `registered`:

```json
{ "registered": false, "registrationToken": "eyJ..." }
```

New number: keep `registrationToken` and open the registration form.

```json
{ "registered": true, "token": "eyJ...", "verificationStatus": "verified" }
```

The number already has an account. Do not register. Store `token` and go to home, or to the login screen if you prefer password login.

| Status | `code` | Show |
|---|---|---|
| 400 | `bad_code` | "The code must be 6 digits" |
| 400 | `otp_incorrect` | "Incorrect code" (5 wrong attempts lock the code) |
| 400 | `otp_expired` | "Code expired" and offer Resend |
| 400 | `otp_missing` / `otp_used` | "Request a new code" |
| 429 | `otp_locked` | "Too many wrong attempts. Request a new code." |

The code expires after 5 minutes (`expiresInSeconds`). Show a countdown.

```dart
class OtpResult {
  final bool registered;
  final String? registrationToken;
  final String? userToken;
  OtpResult(this.registered, this.registrationToken, this.userToken);
}

Future<OtpResult> verifyOtp(String phone, String code) async {
  try {
    final r = await dio.post('/auth/otp/verify', data: {'phone': phone, 'code': code});
    final d = r.data as Map;
    return OtpResult(d['registered'] as bool, d['registrationToken'], d['token']);
  } on DioException catch (e) {
    throw toApiError(e);
  }
}
```

## 6. Step 3: the registration form

`POST /register` is **`multipart/form-data`**, not JSON. Send `Authorization: Bearer <registrationToken>`.

The phone number is taken from the OTP token. Do not send it (if you do, it must match the verified number or you get `phone_mismatch`).

### Fields

| Field | Required | Rules |
|---|---|---|
| `passengerType` | yes | `government` or `private` (`general` is accepted as `private`) |
| `password` | yes | 8 to 128 characters |
| `fullName` | yes | letters, spaces, `. ' -` only, 3 to 255 characters. Sinhala and Tamil letters are allowed |
| `nic` | yes | old: 9 digits + `V`/`X` (e.g. `912345678V`), new: 12 digits (e.g. `199012345678`) |
| `address` | yes | 3 to 500 characters |
| `consent` | yes | must be the string `true` (user ticks the data-collection notice) |
| `email` | no | valid e-mail, max 255 |
| `dateOfBirth` | no | `YYYY-MM-DD` |
| `preferredLanguage` | no | `en`, `si` or `ta` (default `en`) |
| `photo` (or `profilePhoto`) | yes | file, JPEG or PNG, max 5 MB |
| `nicFront` | yes | file, JPEG or PNG, max 5 MB |
| `nicBack` | yes | file, JPEG or PNG, max 5 MB |

Government passengers also send:

| Field | Required | Rules |
|---|---|---|
| `institutionId` | yes (or `institution`) | id from `GET /institutions`. `institution` (the exact name) also works |
| `orgAuthCode` | yes | the organisation's secret code, given to staff by their institution |
| `employeeNo` | no | max 100 |
| `designation` | no | max 150 |

Private passengers can also send `employerName` (optional, max 255).

Load the institution dropdown with `GET /institutions`, which returns `[{ "id": "...", "name": "..." }]`. It needs no auth and exposes names only.

### Client-side validation (mirror the server so errors show before upload)

```dart
final _nameRe = RegExp(r"^[\p{L}][\p{L}\p{M}‍\s.'-]*$", unicode: true);
final _oldNic = RegExp(r'^\d{9}[VvXx]$');
final _newNic = RegExp(r'^\d{12}$');
final _email = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

String? validateName(String? v) {
  final t = (v ?? '').trim();
  if (t.length < 3 || !_nameRe.hasMatch(t)) return 'Enter your full name (letters only, at least 3 characters)';
  return null;
}

String? validateNic(String? v) {
  final t = (v ?? '').trim();
  return (_oldNic.hasMatch(t) || _newNic.hasMatch(t)) ? null : 'Use 9 digits + V/X, or 12 digits';
}

String? validatePassword(String? v) =>
    (v == null || v.length < 8) ? 'At least 8 characters' : (v.length > 128 ? 'Too long' : null);

String? validateEmail(String? v) =>
    (v == null || v.isEmpty || _email.hasMatch(v)) ? null : 'Invalid email address';

String? validateAddress(String? v) =>
    (v == null || v.trim().length < 3) ? 'Address is required' : null;
```

Add a confirm-password field in the UI (the server doesn't need it). Require the consent checkbox before enabling Submit.

### Picking images

```dart
final picker = ImagePicker();

Future<XFile?> pickImage({required bool camera}) => picker.pickImage(
      source: camera ? ImageSource.camera : ImageSource.gallery,
      maxWidth: 1600,        // keeps files well under the 5 MB limit
      imageQuality: 85,
    );
```

The server checks the real file signature, so a renamed `.txt` or `.heic` is rejected with `bad_file_type`. Only JPEG and PNG work. Check the size before upload:

```dart
Future<String?> checkImage(XFile f) async {
  final lower = f.path.toLowerCase();
  if (!(lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png'))) {
    return 'Only JPEG or PNG images are allowed';
  }
  if (await f.length() > 5 * 1024 * 1024) return 'Image must be 5 MB or smaller';
  return null;
}
```

Use clear labels: "Profile photo (face visible)", "NIC front", "NIC back".

### Sending the request

```dart
import 'package:http_parser/http_parser.dart';

class RegisterResult {
  final String userId;
  final String referenceNumber;
  final String verificationStatus;
  final String token;
  RegisterResult(this.userId, this.referenceNumber, this.verificationStatus, this.token);
}

Future<MultipartFile> _file(XFile f) async {
  final isPng = f.path.toLowerCase().endsWith('.png');
  return MultipartFile.fromFile(
    f.path,
    filename: f.name,
    contentType: MediaType('image', isPng ? 'png' : 'jpeg'),
  );
}

Future<RegisterResult> register({
  required String registrationToken,
  required String passengerType, // 'government' | 'private'
  required String password,
  required String fullName,
  required String nic,
  required String address,
  required XFile photo,
  required XFile nicFront,
  required XFile nicBack,
  String? email,
  String? dateOfBirth,        // yyyy-MM-dd
  String preferredLanguage = 'en',
  // government
  String? institutionId,
  String? orgAuthCode,
  String? employeeNo,
  String? designation,
  // private
  String? employerName,
}) async {
  final form = FormData.fromMap({
    'passengerType': passengerType,
    'password': password,
    'fullName': fullName.trim(),
    'nic': nic.trim(),
    'address': address.trim(),
    'consent': 'true',
    'preferredLanguage': preferredLanguage,
    if (email != null && email.isNotEmpty) 'email': email.trim(),
    if (dateOfBirth != null) 'dateOfBirth': dateOfBirth,
    if (passengerType == 'government') ...{
      'institutionId': institutionId,
      'orgAuthCode': orgAuthCode,
      if (employeeNo != null && employeeNo.isNotEmpty) 'employeeNo': employeeNo,
      if (designation != null && designation.isNotEmpty) 'designation': designation,
    },
    if (passengerType == 'private' && employerName != null && employerName.isNotEmpty)
      'employerName': employerName,
    'photo': await _file(photo),
    'nicFront': await _file(nicFront),
    'nicBack': await _file(nicBack),
  });

  try {
    final r = await dio.post(
      '/register',
      data: form,
      options: Options(headers: {'Authorization': 'Bearer $registrationToken'}),
      onSendProgress: (sent, total) { /* update a progress bar */ },
    );
    final d = r.data as Map;
    return RegisterResult(d['userId'], d['referenceNumber'], d['verificationStatus'], d['token']);
  } on DioException catch (e) {
    throw toApiError(e);
  }
}
```

Do not set `Content-Type` yourself. Dio adds `multipart/form-data` with the boundary.

### Success response `201`

```json
{
  "userId": "b1c5…",
  "referenceNumber": "ES-B1C5D2E3",
  "verificationStatus": "pending_verification",
  "token": "eyJ…"
}
```

Save `token` in secure storage (this logs the user in). Show `referenceNumber` to the user.

```dart
const storage = FlutterSecureStorage();
await storage.write(key: 'user_token', value: result.token);
```

### Error handling for `/register`

| Status | `code` | Meaning and what to show |
|---|---|---|
| 400 | `validation_error` | Read `details`. Map each `field` to its form field (`password`, `fullName`, `nic`, `address`, `email`, `dateOfBirth`, `consent`, `passengerType`). Show the message under that field |
| 400 | `missing_document` | A photo or NIC image is missing. Message says which |
| 400 | `bad_file_type` | File isn't a real JPEG or PNG |
| 400 | `upload_error` | File too large (over 5 MB) or too many files |
| 400 | `phone_mismatch` | Only if you sent `phone` and it differs from the verified number |
| 401 | n/a | Registration token missing or expired (30 min). Send the user back to the OTP step |
| 403 | n/a | Government only: "Institution or organisation authentication code is incorrect". The message is deliberately generic. Highlight the institution and code fields |
| 409 | `already_registered` | The phone, NIC or email already has an account. Offer "Log in instead" |
| 429 | n/a | Rate limit. Try later |

Server-side failures delete the uploaded files, so it is safe to retry without cleanup.

## 7. After registration: status screen

`verificationStatus` from the response decides the message:

| Status | Meaning | Show |
|---|---|---|
| `pending_institution_approval` | Government passenger. Waiting for the institution officer | "Your institution is reviewing your request" |
| `pending_verification` | Waiting for station staff to check the NIC and photo | "Station staff will verify your identity" |
| `verified` | Approved | Enable applying for tickets |
| `rejected` | Rejected. See `rejectionReason` from `GET /me` | Show the reason and a "Resubmit documents" button (`POST /me/resubmit`, multipart, same three image fields) |

Flow by type:
- **Private:** `pending_verification` → (station staff) → `verified`
- **Government:** `pending_institution_approval` → (officer) → `pending_verification` → (station staff) → `verified`

Poll `GET /me` (Bearer user token) when the status screen opens or on pull-to-refresh. There are no push notifications yet.

Passengers can't apply for a season ticket until `verified`.

## 8. Using the token afterwards

Add the token to every passenger request:

```dart
dio.interceptors.add(InterceptorsWrapper(
  onRequest: (options, handler) async {
    final t = await storage.read(key: 'user_token');
    if (t != null && !options.headers.containsKey('Authorization')) {
      options.headers['Authorization'] = 'Bearer $t';
    }
    handler.next(options);
  },
  onError: (e, handler) async {
    if (e.response?.statusCode == 401) {
      await storage.delete(key: 'user_token');
      // navigate to the login screen
    }
    handler.next(e);
  },
));
```

User tokens last 7 days. A 401 anywhere means "sign in again".

## 9. Screen checklist

1. **Phone screen:** phone field, validation, "Send code".
2. **OTP screen:** 6-digit input, 5-minute expiry countdown, 60 s resend timer, error messages from section 5.
3. **Registration form:** passenger type selector (Government / Private). Shared fields: full name, NIC, password + confirm, address, email, date of birth, language, three images, consent checkbox. Government shows institution dropdown, organisation code, employee number, designation. Private shows employer name.
4. **Submit:** disable the button, show upload progress, map server field errors to the form.
5. **Status screen:** reference number and the status messages from section 7.

## 10. Privacy notes to show users

- The NIC number is never stored. Only a hash and the last 4 characters are kept.
- NIC images are deleted once the account is verified. The profile photo is kept for ticket inspectors.
- The consent checkbox is mandatory. Use text like: "I agree to my details and photos being collected to verify my identity for season tickets."

## 11. Testing without an SMS

With `OTP_PROVIDER=mock` in the backend `.env` (and `NODE_ENV` not `production`), the OTP request response includes `devCode` and the server console prints it. Use that for local testing. For real SMS, set `OTP_PROVIDER=textlk` and the Text.lk values described in the main README.

Related files: `e_season.postman_collection.json` (request examples) and `e_season.api-spec.json` (full endpoint contract).
