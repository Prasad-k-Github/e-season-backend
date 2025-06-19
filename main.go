package main

import (
	"log"

	"e-season-backend/config"
	"e-season-backend/routes"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	// Initialize configuration
	config.InitConfig()

	// Create Gin router
	router := gin.Default()

	// CORS configuration for Flutter
	corsConfig := cors.DefaultConfig()
	corsConfig.AllowAllOrigins = true
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	corsConfig.AllowHeaders = []string{"Origin", "Content-Type", "Authorization", "Accept", "X-Requested-With"}
	corsConfig.ExposeHeaders = []string{"Content-Length"}
	corsConfig.AllowCredentials = true
	router.Use(cors.New(corsConfig))

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":  "ok",
			"message": "E-Season Backend is running",
		})
	})

	// Setup routes
	routes.SetupPassengerRoutes(router)

	// Start server
	port := config.AppConfig.Port
	log.Printf("Server starting on port %s", port)
	log.Fatal(router.Run(":" + port))
}
