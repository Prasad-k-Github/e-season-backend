# E-Season Backend - Streamlined Version

A streamlined Go-based REST API backend for the E-Season passenger management system, featuring only the essential endpoints for passenger registration, authentication, profile management, and admin operations.

## Features

### Core Functionality
- **Passenger Registration**: Secure account creation with validation
- **Passenger Authentication**: JWT-based login system
- **Profile Management**: Get and update passenger profiles by ID
- **Phone Verification**: OTP-based phone number verification
- **Password Management**: Secure password change functionality
- **Admin Operations**: Comprehensive passenger management for administrators

### Security
- JWT authentication for protected endpoints
- Password hashing using bcrypt
- Input validation and sanitization
- CORS support for cross-origin requests
- No sensitive data exposure in API responses

## Technology Stack

- **Language**: Go 1.21+
- **Framework**: Gin Web Framework
- **Database**: MySQL
- **Authentication**: JWT (JSON Web Tokens)
- **Environment**: Environment variables via .env file

## Project Structure

```
e-season-backend/
├── main.go                           # Application entry point
├── config/
│   └── config.go                     # Configuration management
├── handlers/
│   └── passenger_handler.go          # Request handlers
├── middleware/
│   └── auth.go                       # Authentication middleware
├── models/
│   └── passenger.go                  # Data models
├── routes/
│   └── passenger_routes.go           # Route definitions
├── utils/
│   ├── auth.go                       # JWT utilities
│   └── response.go                   # Response utilities
├── .env                              # Environment variables
├── go.mod                            # Go module dependencies
└── go.sum                            # Dependency checksums
```

## API Endpoints

### Public Endpoints
- `POST /api/v1/passenger/register` - Register new passenger
- `POST /api/v1/passenger/login` - Passenger login

### Protected Endpoints
- `GET /api/v1/passenger/profile/{id}` - Get passenger profile
- `PUT /api/v1/passenger/profile/{id}` - Update passenger profile
- `POST /api/v1/passenger/verify-phone/{id}` - Verify phone number
- `POST /api/v1/passenger/change-password/{id}` - Change password

### Admin Endpoints
- `GET /api/v1/admin/passenger/all` - Get all passengers (paginated)
- `GET /api/v1/admin/passenger/search` - Search passengers by criteria
- `GET /api/v1/admin/passenger/{id}` - Get passenger by ID (admin)
- `POST /api/v1/admin/passenger/multiple` - Get multiple passengers by IDs

### System Endpoints
- `GET /health` - Health check

## Setup Instructions

### Prerequisites
- Go 1.21 or higher
- MySQL 8.0 or higher
- Git

### Database Setup

1. Create a MySQL database:
```sql
CREATE DATABASE e_season;
USE e_season;

CREATE TABLE Passenger (
    passenger_id INT PRIMARY KEY AUTO_INCREMENT,
    name_with_initials VARCHAR(100) NOT NULL,
    full_name VARCHAR(200) NOT NULL,
    address TEXT NOT NULL,
    phone_number VARCHAR(15) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    from_station VARCHAR(100) NOT NULL,
    to_station VARCHAR(100) NOT NULL,
    travel_date DATE NOT NULL,
    password VARCHAR(255) NOT NULL,
    phone_verification_status ENUM('Pending', 'Verified') DEFAULT 'Pending',
    admin_verification_status ENUM('Pending', 'Verified') DEFAULT 'Pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Application Setup

1. **Clone and navigate to the project directory**

2. **Configure environment variables**
   
   Update the `.env` file with your database credentials:
   ```properties
   # Database Configuration
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=your_password
   DB_NAME=e_season

   # JWT Secret (use a strong, random secret in production)
   JWT_SECRET=your_jwt_secret_key

   # Server Configuration
   PORT=8080
   ```

3. **Install dependencies**
   ```bash
   go mod download
   ```

4. **Build the application**
   ```bash
   go build -o e-season-backend-streamlined.exe
   ```

5. **Run the application**
   ```bash
   ./e-season-backend-streamlined.exe
   ```
   
   Or run directly:
   ```bash
   go run main.go
   ```

The server will start on `http://localhost:8080`

## Testing

### Using Postman
Import the provided Postman collection: `E-Season_API_Streamlined.postman_collection.json`

The collection includes:
- Pre-configured requests for all endpoints
- Automatic JWT token management
- Example request/response data
- Organized folder structure by functionality

### Testing Flow
1. **Health Check**: Verify the server is running
2. **Register**: Create a new passenger account (saves JWT token automatically)
3. **Login**: Authenticate existing passenger (saves JWT token automatically)
4. **Profile Operations**: Test get, update, verify phone, change password
5. **Admin Operations**: Test admin endpoints for passenger management

### Sample Test Requests

**Register a Passenger:**
```bash
curl -X POST http://localhost:8080/api/v1/passenger/register \
  -H "Content-Type: application/json" \
  -d '{
    "name_with_initials": "J.K. Silva",
    "full_name": "John Kamal Silva",
    "address": "123 Main Street, Colombo 03, Sri Lanka",
    "phone_number": "+94771234567",
    "email": "john.silva@example.com",
    "from_station": "Colombo Fort",
    "to_station": "Kandy",
    "travel_date": "2025-07-15",
    "password": "securePassword123",
    "confirm_password": "securePassword123"
  }'
```

**Login:**
```bash
curl -X POST http://localhost:8080/api/v1/passenger/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john.silva@example.com",
    "password": "securePassword123"
  }'
```

## Response Format

All API responses follow a consistent format:

**Success Response:**
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {
    // Response data here
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error information (if available)"
}
```

## Security Considerations

- **JWT Tokens**: Use strong, random JWT secrets in production
- **Password Security**: All passwords are hashed using bcrypt
- **Input Validation**: All inputs are validated and sanitized
- **Database Security**: Use prepared statements to prevent SQL injection
- **Environment Variables**: Never commit sensitive data to version control

## Development

### Adding New Endpoints
1. Define the model in `models/passenger.go`
2. Create the handler function in `handlers/passenger_handler.go`
3. Add the route in `routes/passenger_routes.go`
4. Update documentation

### Database Migrations
For schema changes, create migration scripts and update the database manually or use a migration tool.

## Production Deployment

### Environment Variables
Ensure all environment variables are properly set:
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `JWT_SECRET` (use a cryptographically secure random string)
- `PORT` (optional, defaults to 8080)

### Security Checklist
- [ ] Use HTTPS in production
- [ ] Set strong JWT secret
- [ ] Configure database security
- [ ] Enable proper logging
- [ ] Set up monitoring
- [ ] Use environment-specific configurations

## API Documentation

Detailed API documentation is available in `STREAMLINED_API_DOCUMENTATION.md`, which includes:
- Complete endpoint descriptions
- Request/response examples
- Error handling details
- Input validation rules
- Security requirements

## License

This project is part of the E-Season passenger management system.
