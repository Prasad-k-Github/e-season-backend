package handlers

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"

	"e-season-backend/config"
	"e-season-backend/models"
	"e-season-backend/utils"

	"github.com/gin-gonic/gin"
)

// RegisterPassenger handles passenger registration
func RegisterPassenger(c *gin.Context) {
	var req models.PassengerRegistration
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.ErrorResponse(c, http.StatusBadRequest, "Invalid request data", err.Error())
		return
	}

	// Validate password confirmation
	if req.Password != req.ConfirmPassword {
		utils.ErrorResponse(c, http.StatusBadRequest, "Passwords do not match", "")
		return
	}

	// Check if email already exists
	var existingID int
	err := config.AppConfig.DB.QueryRow("SELECT passenger_id FROM Passenger WHERE email = ?", req.Email).Scan(&existingID)
	if err != sql.ErrNoRows {
		if err == nil {
			utils.ErrorResponse(c, http.StatusConflict, "Email already registered", "")
			return
		}
		utils.ErrorResponse(c, http.StatusInternalServerError, "Database error", err.Error())
		return
	}

	// Hash password
	hashedPassword, err := utils.HashPassword(req.Password)
	if err != nil {
		utils.ErrorResponse(c, http.StatusInternalServerError, "Failed to hash password", err.Error())
		return
	}

	// Parse travel date
	travelDate, err := time.Parse("2006-01-02", req.TravelDate)
	if err != nil {
		utils.ErrorResponse(c, http.StatusBadRequest, "Invalid travel date format. Use YYYY-MM-DD", err.Error())
		return
	}

	// Insert passenger into database
	query := `INSERT INTO Passenger (name_with_initials, full_name, address, phone_number, email, 
	          from_station, to_station, travel_date, password) 
	          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`

	result, err := config.AppConfig.DB.Exec(query, req.NameWithInitials, req.FullName, req.Address,
		req.PhoneNumber, req.Email, req.FromStation, req.ToStation, travelDate, hashedPassword)
	if err != nil {
		utils.ErrorResponse(c, http.StatusInternalServerError, "Failed to register passenger", err.Error())
		return
	}

	passengerID, err := result.LastInsertId()
	if err != nil {
		utils.ErrorResponse(c, http.StatusInternalServerError, "Failed to get passenger ID", err.Error())
		return
	}

	// Generate JWT token
	token, err := utils.GenerateJWT(int(passengerID), req.Email, config.AppConfig.JWTSecret)
	if err != nil {
		utils.ErrorResponse(c, http.StatusInternalServerError, "Failed to generate token", err.Error())
		return
	}

	utils.SuccessResponse(c, http.StatusCreated, "Passenger registered successfully", gin.H{
		"passenger_id": passengerID,
		"token":        token,
		"message":      "Registration successful. Please verify your phone number and wait for admin approval.",
	})
}

// LoginPassenger handles passenger login
func LoginPassenger(c *gin.Context) {
	var req models.PassengerLogin
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.ErrorResponse(c, http.StatusBadRequest, "Invalid request data", err.Error())
		return
	}

	// Get passenger from database
	var passenger models.Passenger
	query := `SELECT passenger_id, name_with_initials, full_name, address, phone_number, email, 
	          from_station, to_station, travel_date, password, phone_verification_status, 
	          admin_verification_status, created_at FROM Passenger WHERE email = ?`

	err := config.AppConfig.DB.QueryRow(query, req.Email).Scan(
		&passenger.PassengerID, &passenger.NameWithInitials, &passenger.FullName,
		&passenger.Address, &passenger.PhoneNumber, &passenger.Email,
		&passenger.FromStation, &passenger.ToStation, &passenger.TravelDate,
		&passenger.Password, &passenger.PhoneVerificationStatus,
		&passenger.AdminVerificationStatus, &passenger.CreatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			utils.ErrorResponse(c, http.StatusUnauthorized, "Invalid email or password", "")
			return
		}
		utils.ErrorResponse(c, http.StatusInternalServerError, "Database error", err.Error())
		return
	}

	// Check password
	if !utils.CheckPasswordHash(req.Password, passenger.Password) {
		utils.ErrorResponse(c, http.StatusUnauthorized, "Invalid email or password", "")
		return
	}

	// Generate JWT token
	token, err := utils.GenerateJWT(passenger.PassengerID, passenger.Email, config.AppConfig.JWTSecret)
	if err != nil {
		utils.ErrorResponse(c, http.StatusInternalServerError, "Failed to generate token", err.Error())
		return
	}

	// Create response without password
	passengerResponse := models.PassengerResponse{
		PassengerID:             passenger.PassengerID,
		NameWithInitials:        passenger.NameWithInitials,
		FullName:                passenger.FullName,
		Address:                 passenger.Address,
		PhoneNumber:             passenger.PhoneNumber,
		Email:                   passenger.Email,
		FromStation:             passenger.FromStation,
		ToStation:               passenger.ToStation,
		TravelDate:              passenger.TravelDate,
		PhoneVerificationStatus: passenger.PhoneVerificationStatus,
		AdminVerificationStatus: passenger.AdminVerificationStatus,
		CreatedAt:               passenger.CreatedAt,
	}

	utils.SuccessResponse(c, http.StatusOK, "Login successful", gin.H{
		"token":     token,
		"passenger": passengerResponse,
	})
}

// GetPassengerProfile gets passenger profile by user ID (from URL parameter)
func GetPassengerProfile(c *gin.Context) {
	// Get passenger ID from URL parameter
	userIDParam := c.Param("id")
	if userIDParam == "" {
		utils.ErrorResponse(c, http.StatusBadRequest, "Passenger ID is required", "")
		return
	}

	// Convert string to int and validate
	userID, err := strconv.Atoi(userIDParam)
	if err != nil {
		utils.ErrorResponse(c, http.StatusBadRequest, "Invalid passenger ID format. Must be a valid number", "")
		return
	}

	// Validate passenger ID is positive
	if userID <= 0 {
		utils.ErrorResponse(c, http.StatusBadRequest, "Passenger ID must be a positive number", "")
		return
	}

	var passenger models.Passenger
	query := `SELECT passenger_id, name_with_initials, full_name, address, phone_number, email, 
              from_station, to_station, travel_date, phone_verification_status, 
              admin_verification_status, created_at FROM Passenger WHERE passenger_id = ?`

	err = config.AppConfig.DB.QueryRow(query, userID).Scan(
		&passenger.PassengerID, &passenger.NameWithInitials, &passenger.FullName,
		&passenger.Address, &passenger.PhoneNumber, &passenger.Email,
		&passenger.FromStation, &passenger.ToStation, &passenger.TravelDate,
		&passenger.PhoneVerificationStatus, &passenger.AdminVerificationStatus,
		&passenger.CreatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			utils.ErrorResponse(c, http.StatusNotFound, "Passenger not found with the provided ID", "")
			return
		}
		utils.ErrorResponse(c, http.StatusInternalServerError, "Database error occurred while retrieving passenger", err.Error())
		return
	}

	passengerResponse := models.PassengerResponse{
		PassengerID:             passenger.PassengerID,
		NameWithInitials:        passenger.NameWithInitials,
		FullName:                passenger.FullName,
		Address:                 passenger.Address,
		PhoneNumber:             passenger.PhoneNumber,
		Email:                   passenger.Email,
		FromStation:             passenger.FromStation,
		ToStation:               passenger.ToStation,
		TravelDate:              passenger.TravelDate,
		PhoneVerificationStatus: passenger.PhoneVerificationStatus,
		AdminVerificationStatus: passenger.AdminVerificationStatus,
		CreatedAt:               passenger.CreatedAt,
	}

	utils.SuccessResponse(c, http.StatusOK, "Profile retrieved successfully", passengerResponse)
}

// UpdatePassengerProfile updates passenger profile by ID
func UpdatePassengerProfile(c *gin.Context) {
	// Get passenger ID from URL parameter
	userIDParam := c.Param("id")
	if userIDParam == "" {
		utils.ErrorResponse(c, http.StatusBadRequest, "Passenger ID is required", "")
		return
	}

	// Convert string to int and validate
	userID, err := strconv.Atoi(userIDParam)
	if err != nil {
		utils.ErrorResponse(c, http.StatusBadRequest, "Invalid passenger ID format. Must be a valid number", "")
		return
	}

	// Validate passenger ID is positive
	if userID <= 0 {
		utils.ErrorResponse(c, http.StatusBadRequest, "Passenger ID must be a positive number", "")
		return
	}

	var req models.PassengerRegistration
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.ErrorResponse(c, http.StatusBadRequest, "Invalid request data", err.Error())
		return
	}

	// Parse travel date
	travelDate, err := time.Parse("2006-01-02", req.TravelDate)
	if err != nil {
		utils.ErrorResponse(c, http.StatusBadRequest, "Invalid travel date format. Use YYYY-MM-DD", err.Error())
		return
	}

	// Check if passenger exists first
	var existingID int
	err = config.AppConfig.DB.QueryRow("SELECT passenger_id FROM Passenger WHERE passenger_id = ?", userID).Scan(&existingID)
	if err != nil {
		if err == sql.ErrNoRows {
			utils.ErrorResponse(c, http.StatusNotFound, "Passenger not found with the provided ID", "")
			return
		}
		utils.ErrorResponse(c, http.StatusInternalServerError, "Database error", err.Error())
		return
	}

	// Update passenger profile
	query := `UPDATE Passenger SET name_with_initials = ?, full_name = ?, address = ?, 
	          phone_number = ?, from_station = ?, to_station = ?, travel_date = ? 
	          WHERE passenger_id = ?`

	_, err = config.AppConfig.DB.Exec(query, req.NameWithInitials, req.FullName, req.Address,
		req.PhoneNumber, req.FromStation, req.ToStation, travelDate, userID)
	if err != nil {
		utils.ErrorResponse(c, http.StatusInternalServerError, "Failed to update profile", err.Error())
		return
	}

	utils.SuccessResponse(c, http.StatusOK, "Profile updated successfully", nil)
}

// VerifyPhoneByID updates phone verification status by passenger ID
func VerifyPhoneByID(c *gin.Context) {
	// Get passenger ID from URL parameter
	userIDParam := c.Param("id")
	if userIDParam == "" {
		utils.ErrorResponse(c, http.StatusBadRequest, "Passenger ID is required", "")
		return
	}

	// Convert string to int and validate
	userID, err := strconv.Atoi(userIDParam)
	if err != nil {
		utils.ErrorResponse(c, http.StatusBadRequest, "Invalid passenger ID format. Must be a valid number", "")
		return
	}

	// Validate passenger ID is positive
	if userID <= 0 {
		utils.ErrorResponse(c, http.StatusBadRequest, "Passenger ID must be a positive number", "")
		return
	}

	var req struct {
		PhoneNumber string `json:"phone_number" binding:"required"`
		OTP         string `json:"otp" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		utils.ErrorResponse(c, http.StatusBadRequest, "Invalid request data", err.Error())
		return
	}

	// Check if passenger exists first
	var existingID int
	err = config.AppConfig.DB.QueryRow("SELECT passenger_id FROM Passenger WHERE passenger_id = ?", userID).Scan(&existingID)
	if err != nil {
		if err == sql.ErrNoRows {
			utils.ErrorResponse(c, http.StatusNotFound, "Passenger not found with the provided ID", "")
			return
		}
		utils.ErrorResponse(c, http.StatusInternalServerError, "Database error", err.Error())
		return
	}

	// In a real implementation, you would verify the OTP
	// For now, we'll just mark it as verified
	query := `UPDATE Passenger SET phone_verification_status = 'Verified' WHERE passenger_id = ?`
	_, err = config.AppConfig.DB.Exec(query, userID)
	if err != nil {
		utils.ErrorResponse(c, http.StatusInternalServerError, "Failed to verify phone", err.Error())
		return
	}

	utils.SuccessResponse(c, http.StatusOK, "Phone verified successfully", nil)
}

// ChangePasswordByID changes passenger password by ID
func ChangePasswordByID(c *gin.Context) {
	// Get passenger ID from URL parameter
	userIDParam := c.Param("id")
	if userIDParam == "" {
		utils.ErrorResponse(c, http.StatusBadRequest, "Passenger ID is required", "")
		return
	}

	// Convert string to int and validate
	userID, err := strconv.Atoi(userIDParam)
	if err != nil {
		utils.ErrorResponse(c, http.StatusBadRequest, "Invalid passenger ID format. Must be a valid number", "")
		return
	}

	// Validate passenger ID is positive
	if userID <= 0 {
		utils.ErrorResponse(c, http.StatusBadRequest, "Passenger ID must be a positive number", "")
		return
	}

	var req struct {
		CurrentPassword string `json:"current_password" binding:"required"`
		NewPassword     string `json:"new_password" binding:"required,min=6"`
		ConfirmPassword string `json:"confirm_password" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		utils.ErrorResponse(c, http.StatusBadRequest, "Invalid request data", err.Error())
		return
	}

	if req.NewPassword != req.ConfirmPassword {
		utils.ErrorResponse(c, http.StatusBadRequest, "New passwords do not match", "")
		return
	}

	// Get current password hash
	var currentHash string
	err = config.AppConfig.DB.QueryRow("SELECT password FROM Passenger WHERE passenger_id = ?", userID).Scan(&currentHash)
	if err != nil {
		if err == sql.ErrNoRows {
			utils.ErrorResponse(c, http.StatusNotFound, "Passenger not found with the provided ID", "")
			return
		}
		utils.ErrorResponse(c, http.StatusInternalServerError, "Database error", err.Error())
		return
	}

	// Verify current password
	if !utils.CheckPasswordHash(req.CurrentPassword, currentHash) {
		utils.ErrorResponse(c, http.StatusUnauthorized, "Current password is incorrect", "")
		return
	}

	// Hash new password
	newHash, err := utils.HashPassword(req.NewPassword)
	if err != nil {
		utils.ErrorResponse(c, http.StatusInternalServerError, "Failed to hash password", err.Error())
		return
	}

	// Update password
	query := `UPDATE Passenger SET password = ? WHERE passenger_id = ?`
	_, err = config.AppConfig.DB.Exec(query, newHash, userID)
	if err != nil {
		utils.ErrorResponse(c, http.StatusInternalServerError, "Failed to update password", err.Error())
		return
	}

	utils.SuccessResponse(c, http.StatusOK, "Password changed successfully", nil)
}

// Admin Operations

// GetAllPassengers gets all passengers (for admin)
func GetAllPassengers(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))

	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 10
	}

	offset := (page - 1) * limit

	// Get total count
	var totalCount int
	err := config.AppConfig.DB.QueryRow("SELECT COUNT(*) FROM Passenger").Scan(&totalCount)
	if err != nil {
		utils.ErrorResponse(c, http.StatusInternalServerError, "Database error", err.Error())
		return
	}

	// Get passengers with pagination
	query := `SELECT passenger_id, name_with_initials, full_name, address, phone_number, email, 
	          from_station, to_station, travel_date, phone_verification_status, 
	          admin_verification_status, created_at FROM Passenger 
	          ORDER BY created_at DESC LIMIT ? OFFSET ?`

	rows, err := config.AppConfig.DB.Query(query, limit, offset)
	if err != nil {
		utils.ErrorResponse(c, http.StatusInternalServerError, "Database error", err.Error())
		return
	}
	defer rows.Close()

	var passengers []models.PassengerResponse
	for rows.Next() {
		var passenger models.PassengerResponse
		err := rows.Scan(
			&passenger.PassengerID, &passenger.NameWithInitials, &passenger.FullName,
			&passenger.Address, &passenger.PhoneNumber, &passenger.Email,
			&passenger.FromStation, &passenger.ToStation, &passenger.TravelDate,
			&passenger.PhoneVerificationStatus, &passenger.AdminVerificationStatus,
			&passenger.CreatedAt,
		)
		if err != nil {
			utils.ErrorResponse(c, http.StatusInternalServerError, "Failed to scan passenger", err.Error())
			return
		}
		passengers = append(passengers, passenger)
	}

	utils.SuccessResponse(c, http.StatusOK, "Passengers retrieved successfully", gin.H{
		"passengers":   passengers,
		"total_count":  totalCount,
		"current_page": page,
		"limit":        limit,
		"total_pages":  (totalCount + limit - 1) / limit,
	})
}

// GetPassengersByMultipleIDs gets multiple passengers by their IDs (Admin)
func GetPassengersByMultipleIDs(c *gin.Context) {
	var req struct {
		PassengerIDs []int `json:"passenger_ids" binding:"required,min=1"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		utils.ErrorResponse(c, http.StatusBadRequest, "Invalid request data. Provide an array of passenger IDs", err.Error())
		return
	}

	// Validate passenger IDs
	for _, id := range req.PassengerIDs {
		if id <= 0 {
			utils.ErrorResponse(c, http.StatusBadRequest, "All passenger IDs must be positive numbers", "")
			return
		}
	}

	// Limit the number of IDs that can be requested at once
	if len(req.PassengerIDs) > 50 {
		utils.ErrorResponse(c, http.StatusBadRequest, "Cannot request more than 50 passengers at once", "")
		return
	}

	// Build query with placeholders for IN clause
	placeholders := make([]string, len(req.PassengerIDs))
	args := make([]interface{}, len(req.PassengerIDs))
	for i, id := range req.PassengerIDs {
		placeholders[i] = "?"
		args[i] = id
	}

	query := `SELECT passenger_id, name_with_initials, full_name, address, phone_number, email, 
              from_station, to_station, travel_date, phone_verification_status, 
              admin_verification_status, created_at 
              FROM Passenger 
              WHERE passenger_id IN (` + strings.Join(placeholders, ",") + `)
              ORDER BY passenger_id`

	rows, err := config.AppConfig.DB.Query(query, args...)
	if err != nil {
		utils.ErrorResponse(c, http.StatusInternalServerError, "Database error occurred while retrieving passengers", err.Error())
		return
	}
	defer rows.Close()

	var passengers []models.PassengerResponse
	foundIDs := make(map[int]bool)

	for rows.Next() {
		var passenger models.PassengerResponse
		err := rows.Scan(
			&passenger.PassengerID,
			&passenger.NameWithInitials,
			&passenger.FullName,
			&passenger.Address,
			&passenger.PhoneNumber,
			&passenger.Email,
			&passenger.FromStation,
			&passenger.ToStation,
			&passenger.TravelDate,
			&passenger.PhoneVerificationStatus,
			&passenger.AdminVerificationStatus,
			&passenger.CreatedAt,
		)
		if err != nil {
			utils.ErrorResponse(c, http.StatusInternalServerError, "Failed to scan passenger data", err.Error())
			return
		}
		passengers = append(passengers, passenger)
		foundIDs[passenger.PassengerID] = true
	}

	// Check for any missing passenger IDs
	var notFoundIDs []int
	for _, id := range req.PassengerIDs {
		if !foundIDs[id] {
			notFoundIDs = append(notFoundIDs, id)
		}
	}

	response := gin.H{
		"passengers":      passengers,
		"total_found":     len(passengers),
		"total_requested": len(req.PassengerIDs),
	}

	if len(notFoundIDs) > 0 {
		response["not_found_ids"] = notFoundIDs
	}

	utils.SuccessResponse(c, http.StatusOK, "Passengers data retrieved", response)
}

// SearchPassengers searches for passengers by various criteria (Admin)
func SearchPassengers(c *gin.Context) {
	// Get query parameters
	email := c.Query("email")
	phoneNumber := c.Query("phone_number")
	fromStation := c.Query("from_station")
	toStation := c.Query("to_station")
	verificationStatus := c.Query("verification_status")

	// Pagination parameters
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))

	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 50 {
		limit = 10
	}

	offset := (page - 1) * limit

	// Build dynamic query based on provided parameters
	var whereConditions []string
	var args []interface{}

	if email != "" {
		whereConditions = append(whereConditions, "email LIKE ?")
		args = append(args, "%"+email+"%")
	}

	if phoneNumber != "" {
		whereConditions = append(whereConditions, "phone_number LIKE ?")
		args = append(args, "%"+phoneNumber+"%")
	}

	if fromStation != "" {
		whereConditions = append(whereConditions, "from_station LIKE ?")
		args = append(args, "%"+fromStation+"%")
	}

	if toStation != "" {
		whereConditions = append(whereConditions, "to_station LIKE ?")
		args = append(args, "%"+toStation+"%")
	}

	if verificationStatus != "" {
		if verificationStatus == "phone_verified" {
			whereConditions = append(whereConditions, "phone_verification_status = 'Verified'")
		} else if verificationStatus == "admin_verified" {
			whereConditions = append(whereConditions, "admin_verification_status = 'Verified'")
		}
	}

	// If no search criteria provided, return error
	if len(whereConditions) == 0 {
		utils.ErrorResponse(c, http.StatusBadRequest, "At least one search parameter is required", "")
		return
	}

	whereClause := "WHERE " + strings.Join(whereConditions, " AND ")

	// Get total count
	countQuery := "SELECT COUNT(*) FROM Passenger " + whereClause
	var totalCount int
	err := config.AppConfig.DB.QueryRow(countQuery, args...).Scan(&totalCount)
	if err != nil {
		utils.ErrorResponse(c, http.StatusInternalServerError, "Database error occurred while counting passengers", err.Error())
		return
	}

	// Get passengers with search criteria and pagination
	dataQuery := `SELECT passenger_id, name_with_initials, full_name, address, phone_number, email, 
	              from_station, to_station, travel_date, phone_verification_status, 
	              admin_verification_status, created_at FROM Passenger ` + whereClause + ` 
	              ORDER BY created_at DESC LIMIT ? OFFSET ?`

	// Add pagination parameters to args
	args = append(args, limit, offset)

	rows, err := config.AppConfig.DB.Query(dataQuery, args...)
	if err != nil {
		utils.ErrorResponse(c, http.StatusInternalServerError, "Database error occurred while searching passengers", err.Error())
		return
	}
	defer rows.Close()

	var passengers []models.PassengerResponse
	for rows.Next() {
		var passenger models.PassengerResponse
		err := rows.Scan(
			&passenger.PassengerID, &passenger.NameWithInitials, &passenger.FullName,
			&passenger.Address, &passenger.PhoneNumber, &passenger.Email,
			&passenger.FromStation, &passenger.ToStation, &passenger.TravelDate,
			&passenger.PhoneVerificationStatus, &passenger.AdminVerificationStatus,
			&passenger.CreatedAt,
		)
		if err != nil {
			utils.ErrorResponse(c, http.StatusInternalServerError, "Failed to scan passenger data", err.Error())
			return
		}
		passengers = append(passengers, passenger)
	}

	utils.SuccessResponse(c, http.StatusOK, "Passengers search completed", gin.H{
		"passengers":   passengers,
		"total_count":  totalCount,
		"current_page": page,
		"limit":        limit,
		"total_pages":  (totalCount + limit - 1) / limit,
		"search_criteria": gin.H{
			"email":               email,
			"phone_number":        phoneNumber,
			"from_station":        fromStation,
			"to_station":          toStation,
			"verification_status": verificationStatus,
		},
	})
}
