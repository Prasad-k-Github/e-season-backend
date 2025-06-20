# E-Season Backend API - Enhanced Passenger Data Retrieval

This document describes the enhanced passenger data retrieval features added to the E-Season Backend API.

## Overview

The API has been enhanced with new endpoints that provide improved passenger data retrieval capabilities, including:
- Enhanced single passenger retrieval with better error handling
- Bulk passenger data retrieval
- Advanced search functionality with multiple criteria
- Comprehensive input validation and error reporting

## Base URL
```
http://localhost:8080
```

## Authentication
All protected endpoints require a Bearer token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## New Endpoints

### 1. Enhanced Passenger Data Retrieval

#### Get Passenger Data by ID
- **Endpoint**: `GET /api/v1/passenger/data/{id}`
- **Description**: Get passenger data by specific ID with enhanced error handling and validation
- **Authentication**: Required
- **Parameters**:
  - `id` (path parameter): Passenger ID (must be a positive integer)

**Example Request:**
```http
GET /api/v1/passenger/data/4
Authorization: Bearer <token>
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Passenger data retrieved successfully",
  "data": {
    "passenger_id": 4,
    "name_with_initials": "J.K. Silva",
    "full_name": "John Kamal Silva",
    "address": "123 Main Street, Colombo 03, Sri Lanka",
    "phone_number": "+94771234567",
    "email": "john.silva@example.com",
    "from_station": "Colombo Fort",
    "to_station": "Kandy",
    "travel_date": "2025-07-15T00:00:00Z",
    "phone_verification_status": "Verified",
    "admin_verification_status": "Pending",
    "created_at": "2025-06-20T10:30:00Z"
  }
}
```

**Error Responses:**
- **400 Bad Request**: Invalid passenger ID format
- **404 Not Found**: Passenger not found with the provided ID
- **500 Internal Server Error**: Database error

#### Get Multiple Passengers by IDs
- **Endpoint**: `POST /api/v1/passenger/data/multiple`
- **Description**: Get multiple passengers data by providing an array of passenger IDs
- **Authentication**: Required
- **Limits**: Maximum 50 passenger IDs per request

**Example Request:**
```http
POST /api/v1/passenger/data/multiple
Authorization: Bearer <token>
Content-Type: application/json

{
  "passenger_ids": [1, 2, 3, 4, 5]
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Passengers data retrieved",
  "data": {
    "passengers": [
      {
        "passenger_id": 1,
        "name_with_initials": "A.B. Perera",
        "full_name": "Amal Bandara Perera",
        // ... other fields
      },
      {
        "passenger_id": 2,
        "name_with_initials": "S.M. Fernando",
        "full_name": "Saman Mahinda Fernando",
        // ... other fields
      }
    ],
    "total_found": 2,
    "total_requested": 5,
    "not_found_ids": [3, 4, 5]
  }
}
```

### 2. Admin Search Operations

#### Search Passengers (Admin Only)
- **Endpoint**: `GET /api/v1/admin/passenger/search`
- **Description**: Search passengers by various criteria with pagination
- **Authentication**: Required (Admin access)
- **Search Parameters** (at least one required):
  - `email`: Search by email (partial match)
  - `phone_number`: Search by phone number (partial match)
  - `from_station`: Search by departure station (partial match)
  - `to_station`: Search by destination station (partial match)
  - `verification_status`: Filter by verification status (`phone_verified` or `admin_verified`)
- **Pagination Parameters**:
  - `page`: Page number (default: 1)
  - `limit`: Records per page (max: 50, default: 10)

**Example Requests:**

1. **Search by Email:**
```http
GET /api/v1/admin/passenger/search?email=silva&page=1&limit=10
Authorization: Bearer <token>
```

2. **Search by Route:**
```http
GET /api/v1/admin/passenger/search?from_station=Colombo&to_station=Kandy&page=1&limit=20
Authorization: Bearer <token>
```

3. **Search by Verification Status:**
```http
GET /api/v1/admin/passenger/search?verification_status=phone_verified&page=1&limit=15
Authorization: Bearer <token>
```

4. **Combined Search:**
```http
GET /api/v1/admin/passenger/search?email=silva&from_station=Colombo&verification_status=phone_verified&page=1&limit=10
Authorization: Bearer <token>
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Passengers search completed",
  "data": {
    "passengers": [
      {
        "passenger_id": 1,
        "name_with_initials": "J.K. Silva",
        "full_name": "John Kamal Silva",
        // ... other fields
      }
    ],
    "total_count": 25,
    "current_page": 1,
    "limit": 10,
    "total_pages": 3,
    "search_criteria": {
      "email": "silva",
      "phone_number": "",
      "from_station": "Colombo",
      "to_station": "",
      "verification_status": "phone_verified"
    }
  }
}
```

#### Get Multiple Passengers by IDs (Admin)
- **Endpoint**: `POST /api/v1/admin/passenger/multiple`
- **Description**: Admin endpoint to get multiple passengers data
- **Authentication**: Required (Admin access)
- **Same functionality as user endpoint but with admin privileges**

## Error Handling

All endpoints provide comprehensive error handling with appropriate HTTP status codes:

- **400 Bad Request**: Invalid input data, malformed requests
- **401 Unauthorized**: Missing or invalid authentication token
- **403 Forbidden**: Insufficient permissions for admin endpoints
- **404 Not Found**: Passenger(s) not found
- **500 Internal Server Error**: Database or server errors

**Error Response Format:**
```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error information (if available)"
}
```

## Input Validation

- **Passenger IDs**: Must be positive integers
- **Email**: Must be valid email format for registration
- **Phone Numbers**: Must include country code format
- **Dates**: Must be in YYYY-MM-DD format
- **Pagination**: Page must be ≥ 1, limit must be between 1-50

## Pagination

All list endpoints support pagination:
- `page`: Current page number (starts from 1)
- `limit`: Number of records per page
- Response includes: `total_count`, `current_page`, `limit`, `total_pages`

## Performance Considerations

- Multiple passenger retrieval is limited to 50 IDs per request
- Search queries use database indexes for optimal performance
- Pagination prevents large data transfers
- Database connections are properly managed and closed

## Security Features

- JWT token validation on all protected endpoints
- No sensitive data (passwords) returned in responses
- Input sanitization to prevent SQL injection
- Proper error messages without exposing system internals

## Testing with Postman

Import the provided Postman collection file: `E-Season_API_Updated.postman_collection.json`

The collection includes:
- Organized folders for different endpoint categories
- Pre-configured requests with example data
- Automatic token management (login saves token for subsequent requests)
- Various test scenarios including error cases
- Environment variables for easy testing

### Collection Structure:
1. **System**: Health check endpoints
2. **Authentication**: Login and registration
3. **Passenger Profile Management**: Basic profile operations
4. **Enhanced Passenger Data Retrieval**: New enhanced endpoints
5. **Admin Operations**: Administrative functions with search capabilities

## Migration Notes

The enhanced endpoints are backward compatible with existing functionality. Original endpoints continue to work as before, with the new endpoints providing additional features and better error handling.
