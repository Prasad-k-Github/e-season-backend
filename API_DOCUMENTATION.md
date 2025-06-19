# E-Season Backend API Documentation

Base URL: `http://localhost:8080`

## Authentication

The API uses JWT (JSON Web Tokens) for authentication. After successful login or registration, you'll receive a token that should be included in the `Authorization` header for protected endpoints.

**Header Format:**
```
Authorization: Bearer <your_jwt_token>
```

## Response Format

All API responses follow this standard format:

```json
{
  "success": true/false,
  "message": "Response message",
  "data": { ... }, // Only present on success
  "error": "Error details" // Only present on error
}
```

## Endpoints

### 1. Health Check

**GET** `/health`

Check if the backend server is running.

**Response:**
```json
{
  "status": "ok",
  "message": "E-Season Backend is running"
}
```

---

### 2. Passenger Registration

**POST** `/api/v1/passenger/register`

Register a new passenger.

**Request Body:**
```json
{
  "name_with_initials": "A.B. Silva",
  "full_name": "Amal Bandara Silva",
  "address": "123 Main Street, Colombo 07",
  "phone_number": "+94771234567",
  "email": "amal@example.com",
  "from_station": "Colombo Fort",
  "to_station": "Kandy",
  "travel_date": "2024-12-25",
  "password": "securePassword123",
  "confirm_password": "securePassword123"
}
```

**Success Response (201):**
```json
{
  "success": true,
  "message": "Passenger registered successfully",
  "data": {
    "passenger_id": 1,
    "token": "jwt_token_here",
    "message": "Registration successful. Please verify your phone number and wait for admin approval."
  }
}
```

**Error Responses:**
- `400`: Invalid request data, passwords don't match, or invalid date format
- `409`: Email already registered
- `500`: Server error

---

### 3. Passenger Login

**POST** `/api/v1/passenger/login`

Login with email and password.

**Request Body:**
```json
{
  "email": "amal@example.com",
  "password": "securePassword123"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "jwt_token_here",
    "passenger": {
      "passenger_id": 1,
      "name_with_initials": "A.B. Silva",
      "full_name": "Amal Bandara Silva",
      "address": "123 Main Street, Colombo 07",
      "phone_number": "+94771234567",
      "email": "amal@example.com",
      "from_station": "Colombo Fort",
      "to_station": "Kandy",
      "travel_date": "2024-12-25T00:00:00Z",
      "phone_verification_status": "Not verified",
      "admin_verification_status": "Pending",
      "created_at": "2024-06-08T10:30:00Z"
    }
  }
}
```

**Error Responses:**
- `400`: Invalid request data
- `401`: Invalid email or password
- `500`: Server error

---

### 4. Get Passenger Profile

**GET** `/api/v1/passenger/profile`

Get the current passenger's profile information.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Profile retrieved successfully",
  "data": {
    "passenger_id": 1,
    "name_with_initials": "A.B. Silva",
    "full_name": "Amal Bandara Silva",
    "address": "123 Main Street, Colombo 07",
    "phone_number": "+94771234567",
    "email": "amal@example.com",
    "from_station": "Colombo Fort",
    "to_station": "Kandy",
    "travel_date": "2024-12-25T00:00:00Z",
    "phone_verification_status": "Not verified",
    "admin_verification_status": "Pending",
    "created_at": "2024-06-08T10:30:00Z"
  }
}
```

**Error Responses:**
- `401`: Unauthorized (invalid or missing token)
- `404`: Passenger not found
- `500`: Server error

---

### 5. Update Passenger Profile

**PUT** `/api/v1/passenger/profile`

Update the current passenger's profile information.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "name_with_initials": "A.B. Silva",
  "full_name": "Amal Bandara Silva Updated",
  "address": "456 New Street, Colombo 03",
  "phone_number": "+94771234567",
  "from_station": "Colombo Fort",
  "to_station": "Galle",
  "travel_date": "2024-12-30"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": null
}
```

**Error Responses:**
- `400`: Invalid request data or date format
- `401`: Unauthorized
- `500`: Server error

---

### 6. Verify Phone Number

**POST** `/api/v1/passenger/verify-phone`

Mark the passenger's phone number as verified.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Phone verified successfully",
  "data": null
}
```

**Error Responses:**
- `401`: Unauthorized
- `500`: Server error

---

### 7. Change Password

**POST** `/api/v1/passenger/change-password`

Change the passenger's password.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "current_password": "oldPassword123",
  "new_password": "newPassword123",
  "confirm_password": "newPassword123"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Password changed successfully",
  "data": null
}
```

**Error Responses:**
- `400`: Invalid request data or passwords don't match
- `401`: Unauthorized or current password incorrect
- `500`: Server error

---

### 8. Get All Passengers (Admin)

**GET** `/api/v1/admin/passenger/all`

Get all passengers with pagination (for admin use).

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10, max: 100)

**Example:** `/api/v1/admin/passenger/all?page=2&limit=20`

**Success Response (200):**
```json
{
  "success": true,
  "message": "Passengers retrieved successfully",
  "data": {
    "passengers": [
      {
        "passenger_id": 1,
        "name_with_initials": "A.B. Silva",
        "full_name": "Amal Bandara Silva",
        "address": "123 Main Street, Colombo 07",
        "phone_number": "+94771234567",
        "email": "amal@example.com",
        "from_station": "Colombo Fort",
        "to_station": "Kandy",
        "travel_date": "2024-12-25T00:00:00Z",
        "phone_verification_status": "Not verified",
        "admin_verification_status": "Pending",
        "created_at": "2024-06-08T10:30:00Z"
      }
    ],
    "total_count": 150,
    "current_page": 2,
    "limit": 20,
    "total_pages": 8
  }
}
```

**Error Responses:**
- `401`: Unauthorized
- `500`: Server error

---

## Flutter Integration Examples

### 1. Making HTTP Requests

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class ApiService {
  static const String baseUrl = 'http://localhost:8080';
  static String? _token;

  static void setToken(String token) {
    _token = token;
  }

  static Map<String, String> get headers => {
    'Content-Type': 'application/json',
    if (_token != null) 'Authorization': 'Bearer $_token',
  };
}
```

### 2. Registration Example

```dart
Future<Map<String, dynamic>> registerPassenger({
  required String nameWithInitials,
  required String fullName,
  required String address,
  required String phoneNumber,
  required String email,
  required String fromStation,
  required String toStation,
  required String travelDate,
  required String password,
  required String confirmPassword,
}) async {
  final response = await http.post(
    Uri.parse('${ApiService.baseUrl}/api/v1/passenger/register'),
    headers: ApiService.headers,
    body: jsonEncode({
      'name_with_initials': nameWithInitials,
      'full_name': fullName,
      'address': address,
      'phone_number': phoneNumber,
      'email': email,
      'from_station': fromStation,
      'to_station': toStation,
      'travel_date': travelDate,
      'password': password,
      'confirm_password': confirmPassword,
    }),
  );

  return jsonDecode(response.body);
}
```

### 3. Login Example

```dart
Future<Map<String, dynamic>> loginPassenger({
  required String email,
  required String password,
}) async {
  final response = await http.post(
    Uri.parse('${ApiService.baseUrl}/api/v1/passenger/login'),
    headers: ApiService.headers,
    body: jsonEncode({
      'email': email,
      'password': password,
    }),
  );

  final data = jsonDecode(response.body);
  
  if (data['success']) {
    ApiService.setToken(data['data']['token']);
  }
  
  return data;
}
```

### 4. Get Profile Example

```dart
Future<Map<String, dynamic>> getProfile() async {
  final response = await http.get(
    Uri.parse('${ApiService.baseUrl}/api/v1/passenger/profile'),
    headers: ApiService.headers,
  );

  return jsonDecode(response.body);
}
```

## Error Handling

Always check the `success` field in the response:

```dart
final response = await apiCall();
if (response['success']) {
  // Handle success
  final data = response['data'];
} else {
  // Handle error
  final errorMessage = response['message'];
  final errorDetails = response['error']; // May be null
}
```

## Status Codes

- `200`: Success
- `201`: Created (for registration)
- `400`: Bad Request (validation errors)
- `401`: Unauthorized (authentication required)
- `404`: Not Found
- `409`: Conflict (email already exists)
- `500`: Internal Server Error

## Notes

1. All dates should be in `YYYY-MM-DD` format when sending to the API
2. Phone numbers should include country code (e.g., +94771234567)
3. Passwords must be at least 6 characters long
4. JWT tokens expire after 24 hours
5. For production, use HTTPS instead of HTTP
6. Store JWT tokens securely in your Flutter app (consider using flutter_secure_storage)
