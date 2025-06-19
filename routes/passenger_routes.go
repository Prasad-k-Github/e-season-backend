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
		protected.GET("/profile", handlers.GetPassengerProfile)
		protected.PUT("/profile", handlers.UpdatePassengerProfile)
		protected.POST("/verify-phone", handlers.VerifyPhone)
		protected.POST("/change-password", handlers.ChangePassword)
	}

	// Admin routes (for admin operations)
	admin := router.Group("/api/v1/admin/passenger")
	admin.Use(middleware.AuthMiddleware()) // You might want to add admin-specific middleware
	{
		admin.GET("/all", handlers.GetAllPassengers)
	}
}
