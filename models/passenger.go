package models

import (
	"time"
)

type Passenger struct {
	PassengerID               int       `json:"passenger_id" db:"passenger_id"`
	NameWithInitials          string    `json:"name_with_initials" db:"name_with_initials"`
	FullName                  string    `json:"full_name" db:"full_name"`
	Address                   string    `json:"address" db:"address"`
	PhoneNumber               string    `json:"phone_number" db:"phone_number"`
	Email                     string    `json:"email" db:"email"`
	FromStation               string    `json:"from_station" db:"from_station"`
	ToStation                 string    `json:"to_station" db:"to_station"`
	TravelDate                time.Time `json:"travel_date" db:"travel_date"`
	Password                  string    `json:"password,omitempty" db:"password"`
	PhoneVerificationStatus   string    `json:"phone_verification_status" db:"phone_verification_status"`
	AdminVerificationStatus   string    `json:"admin_verification_status" db:"admin_verification_status"`
	CreatedAt                 time.Time `json:"created_at" db:"created_at"`
}

type PassengerRegistration struct {
	NameWithInitials string `json:"name_with_initials" binding:"required"`
	FullName         string `json:"full_name" binding:"required"`
	Address          string `json:"address" binding:"required"`
	PhoneNumber      string `json:"phone_number" binding:"required"`
	Email            string `json:"email" binding:"required,email"`
	FromStation      string `json:"from_station" binding:"required"`
	ToStation        string `json:"to_station" binding:"required"`
	TravelDate       string `json:"travel_date" binding:"required"`
	Password         string `json:"password" binding:"required,min=6"`
	ConfirmPassword  string `json:"confirm_password" binding:"required"`
}

type PassengerLogin struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type PassengerResponse struct {
	PassengerID               int       `json:"passenger_id"`
	NameWithInitials          string    `json:"name_with_initials"`
	FullName                  string    `json:"full_name"`
	Address                   string    `json:"address"`
	PhoneNumber               string    `json:"phone_number"`
	Email                     string    `json:"email"`
	FromStation               string    `json:"from_station"`
	ToStation                 string    `json:"to_station"`
	TravelDate                time.Time `json:"travel_date"`
	PhoneVerificationStatus   string    `json:"phone_verification_status"`
	AdminVerificationStatus   string    `json:"admin_verification_status"`
	CreatedAt                 time.Time `json:"created_at"`
}
