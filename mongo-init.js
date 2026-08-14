const dbName = process.env.MONGO_INITDB_DATABASE || "mydatabase";

db = db.getSiblingDB(dbName);

db.createUser({
  user: process.env.MONGO_APP_USERNAME,
  pwd: process.env.MONGO_APP_PASSWORD,
  roles: [{ role: "readWrite", db: dbName }],
});

print("Application database user created successfully!");
