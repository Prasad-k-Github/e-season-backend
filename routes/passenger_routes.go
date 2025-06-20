package routes

import (
	"e-season-backend/handlers"
	"e-season-backend/middleware"

	"github.com/gin-gonic/gin"
)

// SetupPassengerRoutes sets up all passenger-related routes
func SetupPassengerRoutes(router *gin.Engine) {
	// Public routes (no authentication required)
	public := router.Group("/api/v1/passenger")
	{
		public.POST("/register", handlers.RegisterPassenger)
		public.POST("/login", handlers.LoginPassenger)
	}

	// Protected routes (authentication required)
	protected := router.Group("/api/v1/passenger")
	protected.Use(middleware.AuthMiddleware())
	{
		// Passenger-specific operations by ID
		protected.GET("/profile/:id", handlers.GetPassengerProfile)         // Get Passenger Profile by ID
		protected.PUT("/profile/:id", handlers.UpdatePassengerProfile)      // Update Passenger Profile by ID
		protected.POST("/verify-phone/:id", handlers.VerifyPhoneByID)       // Verify Phone Number by ID
		protected.POST("/change-password/:id", handlers.ChangePasswordByID) // Change Password by ID
	}

	// Admin routes (for admin operations)
	admin := router.Group("/api/v1/admin/passenger")
	admin.Use(middleware.AuthMiddleware()) // You might want to add admin-specific middleware
	{
		admin.GET("/all", handlers.GetAllPassengers)                 // Get All Passengers (Admin)
		admin.GET("/search", handlers.SearchPassengers)              // Search Passengers (Admin)
		admin.GET("/:id", handlers.GetPassengerProfile)              // Get Passenger by ID (Admin)
		admin.POST("/multiple", handlers.GetPassengersByMultipleIDs) // Get Multiple Passengers by IDs (Admin)
	}
}
