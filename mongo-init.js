db = db.getSiblingDB("mydatabase");  // Switch to "mydatabase"

db.createCollection("users");  // Create an empty "users" collection

db.users.insertOne({ name: "Admin User", email: "admin@example.com" });  // Insert sample data

print("Database and collection initialized successfully!");
