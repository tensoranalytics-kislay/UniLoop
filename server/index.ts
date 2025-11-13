import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();

// Trust proxy for Replit deployment (required for secure cookies)
app.set('trust proxy', 1);

// Increase body size limit for image uploads (50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  // Enhanced CORS and request logging for diagnostics
  const origin = req.headers.origin;
  const userAgent = req.headers['user-agent'];
  const requestId = req.headers['x-request-id'];
  
  if (path.includes('/api/amenities/sick-food')) {
    console.log(`🔍 [REQUEST-TRACE] Sick food request - Origin: ${origin}, User-Agent: ${userAgent?.substring(0, 50)}...`);
  }

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (requestId) {
        logLine += ` [${requestId}]`;
      }

      if (logLine.length > 100) {
        logLine = logLine.slice(0, 99) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Environment verification logging
console.log(`🚀 Server Starting - ${new Date().toISOString()}`);
console.log(`📍 Environment: ${process.env.NODE_ENV}`);
console.log(`🗄️ Database URL: ${process.env.DATABASE_URL ? '[CONFIGURED]' : '[MISSING]'}`);
console.log(`🔑 Auth0 Domain: ${process.env.AUTH0_DOMAIN ? '[CONFIGURED]' : '[MISSING]'}`);
console.log(`🌐 Port: ${process.env.PORT || 5000}`);

// Check Auth0 configuration
const isAuth0Configured = !!(process.env.AUTH0_DOMAIN && process.env.AUTH0_CLIENT_ID && process.env.AUTH0_CLIENT_SECRET);
if (isAuth0Configured) {
  console.log("Auth0 configured for simplified Google OAuth authentication.");
} else {
  console.log("Auth0 environment variables not configured. Using fallback authentication.");
}

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // Log the error for debugging
    console.error("Server error:", {
      status,
      message: err.message,
      stack: err.stack,
      url: _req.url,
      method: _req.method
    });

    // Send error response to client
    res.status(status).json({ message });
    
    // Do not throw after response - this can crash the server
    // The error has been logged and response sent, middleware should return
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  
  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is busy, retrying in 1 second...`);
      setTimeout(() => {
        server.close();
        server.listen(port, "0.0.0.0", () => {
          log(`serving on port ${port}`);
        });
      }, 1000);
    } else {
      console.error('Server error:', err);
    }
  });
  
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
  });
})();
