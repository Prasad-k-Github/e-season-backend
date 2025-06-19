package middleware

import (
	"net/http"
	"strings"

	"e-season-backend/config"
	"e-season-backend/utils"

	"github.com/gin-gonic/gin"
)

// AuthMiddleware validates JWT token and sets passenger_id in context
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			utils.ErrorResponse(c, http.StatusUnauthorized, "Authorization header required", "")
			c.Abort()
			return
		}

		// Check if it starts with "Bearer "
		tokenString := ""
		if strings.HasPrefix(authHeader, "Bearer ") {
			tokenString = authHeader[7:]
		} else {
			tokenString = authHeader
		}

		if tokenString == "" {
			utils.ErrorResponse(c, http.StatusUnauthorized, "Token required", "")
			c.Abort()
			return
		}

		// Validate token
		claims, err := utils.ValidateJWT(tokenString, config.AppConfig.JWTSecret)
		if err != nil {
			utils.ErrorResponse(c, http.StatusUnauthorized, "Invalid token", err.Error())
			c.Abort()
			return
		}

		// Set passenger_id in context
		c.Set("passenger_id", claims.PassengerID)
		c.Set("email", claims.Email)
		c.Next()
	}
}

// OptionalAuthMiddleware validates JWT token if present but doesn't require it
func OptionalAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			tokenString := ""
			if strings.HasPrefix(authHeader, "Bearer ") {
				tokenString = authHeader[7:]
			} else {
				tokenString = authHeader
			}

			if tokenString != "" {
				claims, err := utils.ValidateJWT(tokenString, config.AppConfig.JWTSecret)
				if err == nil {
					c.Set("passenger_id", claims.PassengerID)
					c.Set("email", claims.Email)
				}
			}
		}
		c.Next()
	}
}
