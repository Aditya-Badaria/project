const express = require("express");
const mysql2 = require("mysql2");
const fileuploader = require("express-fileupload");
const nodemailer = require("nodemailer");
const cloudinary = require('cloudinary').v2;
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 2005;

// Middleware
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(fileuploader({
    limits: { fileSize: 50 * 1024 * 1024 },
    abortOnLimit: true
}));

// Database Configuration
const dbConfig = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "admin123b@dera",
  database: process.env.DB_NAME || "project",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
};

// Create connection pool
const pool = mysql2.createPool(dbConfig);

// Test connection
pool.getConnection((err, connection) => {
  if (err) {
    console.error("❌ Database connection failed:", err.message);
    process.exit(1);
  }
  console.log("✅ Connected to database successfully");
  connection.release();
});

// Handle pool errors
pool.on('error', (err) => {
  console.error('Database pool error:', err);
});

// Cloudinary Configuration
cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
    api_key: process.env.CLOUDINARY_API_KEY, 
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const sanitizeInput = (input) => {
    return typeof input === 'string' ? input.trim() : input;
};

// Email Configuration
const createEmailTransporter = () => {
    return nodemailer.createTransporter({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
            user: process.env.EMAIL_USER || 'adityabadaria1234@gmail.com',
            pass: process.env.EMAIL_PASS || 'dybk opck fwxu ccgg',
        }
    });
};

// Routes

// Home Route
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index2.html"));
});

// Authentication Routes
app.get("/signup-process", (req, res) => {
    const { txtemail, txtpwd, utype } = req.query;
    
    if (!txtemail || !txtpwd || !utype) {
        return res.status(400).send("Missing required fields");
    }
    
    if (!validateEmail(txtemail)) {
        return res.status(400).send("Invalid email format");
    }

    const query = "INSERT INTO users VALUES(?,?,?,?)";
    pool.query(query, [sanitizeInput(txtemail), sanitizeInput(txtpwd), sanitizeInput(utype), 1], (err) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                res.send("<i>Already signed up</i>");
            } else {
                handleDatabaseError(err, res, "Signup failed");
            }
        } else {
            res.send("<i>Signed up successfully</i>");
        }
    });
});

app.get("/login-process", (req, res) => {
    const { txtemaill, txtpwdd } = req.query;
    
    if (!txtemaill || !txtpwdd) {
        return res.status(400).send("Email and password are required");
    }
    
    if (!validateEmail(txtemaill)) {
        return res.status(400).send("Invalid email format");
    }

    const query = "SELECT * FROM users WHERE email=? AND pwd=?";
    pool.query(query, [sanitizeInput(txtemaill), sanitizeInput(txtpwdd)], (err, result) => {
        if (err) {
            return handleDatabaseError(err, res, "Login failed");
        }
        
        if (result.length === 0) {
            return res.send("Invalid email or password");
        }
        
        if (result[0].status == 1) {
            res.send(result[0].utype);
        } else {
            res.send("Account is blocked");
        }
    });
});

// Password Management
app.get("/change-password", (req, res) => {
    const { oldpwd, newpwd, reppwd, setemail } = req.query;
    
    if (!oldpwd || !newpwd || !reppwd || !setemail) {
        return res.status(400).send("All fields are required");
    }
    
    if (newpwd !== reppwd) {
        return res.send("New passwords do not match");
    }
    
    if (newpwd.length < 6) {
        return res.send("Password must be at least 6 characters long");
    }

    // Verify old password first
    const verifyQuery = "SELECT * FROM users WHERE pwd=? AND email=?";
    pool.query(verifyQuery, [sanitizeInput(oldpwd), sanitizeInput(setemail)], (err, result) => {
        if (err) {
            return handleDatabaseError(err, res, "Password verification failed");
        }
        
        if (result.length === 0) {
            return res.send("Incorrect old password");
        }

        // Update password
        const updateQuery = "UPDATE users SET pwd=? WHERE email=?";
        pool.query(updateQuery, [sanitizeInput(newpwd), sanitizeInput(setemail)], (err) => {
            if (err) {
                return handleDatabaseError(err, res, "Password update failed");
            }
            res.send("Password changed successfully");
        });
    });
});

app.get("/forgot-pwd", (req, res) => {
    const { txtemaill } = req.query;
    
    if (!txtemaill || !validateEmail(txtemaill)) {
        return res.status(400).send("Valid email is required");
    }

    const query = "SELECT pwd FROM users WHERE email=?";
    pool.query(query, [sanitizeInput(txtemaill)], (err, result) => {
        if (err) {
            return handleDatabaseError(err, res, "Password retrieval failed");
        }
        
        if (result.length === 0) {
            return res.send("Email not found");
        }

        const transporter = createEmailTransporter();
        const mailOptions = {
            from: process.env.EMAIL_USER || 'adityabadaria1234@gmail.com',
            to: txtemaill,
            subject: "Password Recovery",
            html: `<h3>Password Recovery</h3><p>Your password is: <strong>${result[0].pwd}</strong></p><p>Please consider changing your password after logging in.</p>`
        };

        transporter.sendMail(mailOptions, (error) => {
            if (error) {
                console.error("Email sending error:", error);
                res.send("Failed to send email");
            } else {
                res.send("Password sent to your email");
            }
        });
    });
});

// File Upload Helper
const uploadToCloudinary = async (filePath) => {
    try {
        const result = await cloudinary.uploader.upload(filePath, {
            resource_type: "auto",
            folder: "profile_pics"
        });
        return result.secure_url;
    } catch (error) {
        console.error("Cloudinary upload error:", error);
        throw error;
    }
};

// Profile Routes
app.post("/infl-profile-save", async (req, res) => {
    try {
        let fileName = "noPic.jpg";
        
        if (req.files && req.files.ppic) {
            const uploadedFile = req.files.ppic;
            const tempPath = path.join(__dirname, "public", "uploads", uploadedFile.name);
            
            // Ensure uploads directory exists
            const uploadsDir = path.dirname(tempPath);
            if (!fs.existsSync(uploadsDir)) {
                fs.mkdirSync(uploadsDir, { recursive: true });
            }
            
            await uploadedFile.mv(tempPath);
            fileName = await uploadToCloudinary(tempPath);
            
            // Clean up temporary file
            fs.unlinkSync(tempPath);
        }

        const {
            emailid, uname, gender, dob, address, city, contact,
            fields, insta, fb, yt, other
        } = req.body;

        const fieldsString = Array.isArray(fields) ? fields.join(',') : fields || '';
        
        const query = "INSERT INTO iprofile VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)";
        const values = [
            sanitizeInput(emailid), sanitizeInput(uname), sanitizeInput(gender),
            dob, sanitizeInput(address), sanitizeInput(city), sanitizeInput(contact),
            fieldsString, sanitizeInput(insta), sanitizeInput(fb), sanitizeInput(yt),
            sanitizeInput(other), fileName
        ];

        pool.query(query, values, (err) => {
            if (err) {
                return handleDatabaseError(err, res, "Profile save failed");
            }
            res.redirect("result.html");
        });
    } catch (error) {
        console.error("Profile save error:", error);
        res.status(500).send("Profile save failed");
    }
});

app.post("/infl-profile-update", async (req, res) => {
    try {
        let fileName = req.body.hdn || "noPic.jpg";
        
        if (req.files && req.files.ppic) {
            const uploadedFile = req.files.ppic;
            const tempPath = path.join(__dirname, "public", "uploads", uploadedFile.name);
            
            await uploadedFile.mv(tempPath);
            fileName = await uploadToCloudinary(tempPath);
            
            // Clean up temporary file
            fs.unlinkSync(tempPath);
        }

        const {
            uname, gender, dob, address, city, contact,
            fields, insta, fb, yt, other, emailid
        } = req.body;

        const fieldsString = Array.isArray(fields) ? fields.join(',') : fields || '';
        
        const query = `UPDATE iprofile SET name=?, gender=?, dob=?, address=?, city=?, 
                       contact=?, fields=?, insta=?, fb=?, yt=?, other=?, picpath=? 
                       WHERE emailid=?`;
        
        const values = [
            sanitizeInput(uname), sanitizeInput(gender), dob, sanitizeInput(address),
            sanitizeInput(city), sanitizeInput(contact), fieldsString,
            sanitizeInput(insta), sanitizeInput(fb), sanitizeInput(yt),
            sanitizeInput(other), fileName, sanitizeInput(emailid)
        ];

        pool.query(query, values, (err, result) => {
            if (err) {
                return handleDatabaseError(err, res, "Profile update failed");
            }
            
            if (result.affectedRows >= 1) {
                res.redirect("result.html");
            } else {
                res.send("Invalid email ID");
            }
        });
    } catch (error) {
        console.error("Profile update error:", error);
        res.status(500).send("Profile update failed");
    }
});

// Data Retrieval Routes
app.get("/find-user-details", (req, res) => {
    const { emailid } = req.query;
    
    if (!emailid || !validateEmail(emailid)) {
        return res.status(400).send("Valid email is required");
    }

    const query = "SELECT * FROM iprofile WHERE emailid=?";
    pool.query(query, [sanitizeInput(emailid)], (err, result) => {
        if (err) {
            return handleDatabaseError(err, res, "User details retrieval failed");
        }
        res.json(result);
    });
});

app.get("/find-client-details", (req, res) => {
    const { email } = req.query;
    
    if (!email || !validateEmail(email)) {
        return res.status(400).send("Valid email is required");
    }

    const query = "SELECT * FROM cprofile WHERE email=?";
    pool.query(query, [sanitizeInput(email)], (err, result) => {
        if (err) {
            return handleDatabaseError(err, res, "Client details retrieval failed");
        }
        res.json(result);
    });
});

// Search and Filter Routes
app.get("/find-influ", (req, res) => {
    const { fields } = req.query;
    
    if (!fields) {
        return res.status(400).send("Fields parameter is required");
    }

    const query = "SELECT * FROM iprofile WHERE fields LIKE ?";
    pool.query(query, [`%${sanitizeInput(fields)}%`], (err, result) => {
        if (err) {
            return handleDatabaseError(err, res, "Influencer search failed");
        }
        res.json(result);
    });
});

app.get("/do-find", (req, res) => {
    const { fields, city } = req.query;
    
    if (!fields || !city) {
        return res.status(400).send("Fields and city parameters are required");
    }

    const query = "SELECT * FROM iprofile WHERE fields LIKE ? AND city = ?";
    pool.query(query, [`%${sanitizeInput(fields)}%`, sanitizeInput(city)], (err, result) => {
        if (err) {
            return handleDatabaseError(err, res, "Influencer search failed");
        }
        res.json(result);
    });
});

app.get("/do-findbyname", (req, res) => {
    const { pname } = req.query;
    
    if (!pname) {
        return res.status(400).send("Name parameter is required");
    }

    const query = "SELECT * FROM iprofile WHERE name LIKE ?";
    pool.query(query, [`%${sanitizeInput(pname)}%`], (err, result) => {
        if (err) {
            return handleDatabaseError(err, res, "Name search failed");
        }
        res.json(result);
    });
});

app.get("/fetch-suggestions", (req, res) => {
    const { search } = req.query;
    
    if (!search) {
        return res.json([]);
    }

    const query = "SELECT name FROM iprofile WHERE name LIKE ? LIMIT 10";
    pool.query(query, [`%${sanitizeInput(search)}%`], (err, results) => {
        if (err) {
            return handleDatabaseError(err, res, "Suggestions fetch failed");
        }
        res.json(results.map(row => row.name));
    });
});

// Admin Routes
app.get("/fetch-all", (req, res) => {
    const query = "SELECT email, utype, status FROM users";
    pool.query(query, (err, result) => {
        if (err) {
            return handleDatabaseError(err, res, "Users fetch failed");
        }
        res.json(result);
    });
});

app.get("/fetch-all-influ", (req, res) => {
    const query = "SELECT * FROM iprofile";
    pool.query(query, (err, result) => {
        if (err) {
            return handleDatabaseError(err, res, "Influencers fetch failed");
        }
        res.json(result);
    });
});

// User Management Routes
app.get("/del-one", (req, res) => {
    const { email } = req.query;
    
    if (!email || !validateEmail(email)) {
        return res.status(400).send("Valid email is required");
    }

    const query = "DELETE FROM users WHERE email=?";
    pool.query(query, [sanitizeInput(email)], (err) => {
        if (err) {
            return handleDatabaseError(err, res, "User deletion failed");
        }
        res.send("User deleted successfully");
    });
});

app.get("/block-one", (req, res) => {
    const { email } = req.query;
    
    if (!email || !validateEmail(email)) {
        return res.status(400).send("Valid email is required");
    }

    const query = "UPDATE users SET status=0 WHERE email=?";
    pool.query(query, [sanitizeInput(email)], (err) => {
        if (err) {
            return handleDatabaseError(err, res, "User blocking failed");
        }
        res.send("User blocked successfully");
    });
});

app.get("/resume-one", (req, res) => {
    const { email } = req.query;
    
    if (!email || !validateEmail(email)) {
        return res.status(400).send("Valid email is required");
    }

    const query = "UPDATE users SET status=1 WHERE email=?";
    pool.query(query, [sanitizeInput(email)], (err) => {
        if (err) {
            return handleDatabaseError(err, res, "User resuming failed");
        }
        res.send("User resumed successfully");
    });
});

// Events Management
app.get("/check-post-events", (req, res) => {
    const { emailid, events, doe, tos, city, venue } = req.query;
    
    if (!emailid || !events || !doe || !tos || !city || !venue) {
        return res.status(400).send("All event fields are required");
    }

    const query = "INSERT INTO events VALUES(null,?,?,?,?,?,?)";
    const values = [
        sanitizeInput(emailid), sanitizeInput(events), doe,
        sanitizeInput(tos), sanitizeInput(city), sanitizeInput(venue)
    ];

    pool.query(query, values, (err, result) => {
        if (err) {
            return handleDatabaseError(err, res, "Event creation failed");
        }
        res.json({ success: true, insertId: result.insertId });
    });
});

app.get("/get-all-events", (req, res) => {
    const query = "SELECT * FROM events WHERE doe >= CURRENT_DATE()";
    pool.query(query, (err, result) => {
        if (err) {
            return handleDatabaseError(err, res, "Events fetch failed");
        }
        res.json(result);
    });
});

app.get("/del-pls", (req, res) => {
    const { emailid } = req.query;
    
    if (!emailid || !validateEmail(emailid)) {
        return res.status(400).send("Valid email is required");
    }

    const query = "DELETE FROM events WHERE emailid=?";
    pool.query(query, [sanitizeInput(emailid)], (err) => {
        if (err) {
            return handleDatabaseError(err, res, "Event deletion failed");
        }
        res.send("Event deleted successfully");
    });
});

// Client Profile Management
app.post("/client-profile-save", (req, res) => {
    const { email, cname, city, state, org, mobile } = req.body;
    
    if (!email || !cname || !city || !state || !org || !mobile) {
        return res.status(400).send("All fields are required");
    }
    
    if (!validateEmail(email)) {
        return res.status(400).send("Invalid email format");
    }

    const query = "INSERT INTO cprofile VALUES(?,?,?,?,?,?)";
    const values = [
        sanitizeInput(email), sanitizeInput(cname), sanitizeInput(city),
        sanitizeInput(state), sanitizeInput(org), sanitizeInput(mobile)
    ];

    pool.query(query, values, (err) => {
        if (err) {
            return handleDatabaseError(err, res, "Client profile save failed");
        }
        res.send("Client details saved successfully");
    });
});

app.post("/client-profile-modify", (req, res) => {
    const { email, cname, city, state, org, mobile } = req.body;
    
    if (!email || !validateEmail(email)) {
        return res.status(400).send("Valid email is required");
    }

    const query = "UPDATE cprofile SET name=?, city=?, state=?, org=?, mobile=? WHERE email=?";
    const values = [
        sanitizeInput(cname), sanitizeInput(city), sanitizeInput(state),
        sanitizeInput(org), sanitizeInput(mobile), sanitizeInput(email)
    ];

    pool.query(query, values, (err, result) => {
        if (err) {
            return handleDatabaseError(err, res, "Client profile update failed");
        }
        
        if (result.affectedRows >= 1) {
            res.redirect("result.html");
        } else {
            res.send("Invalid email ID");
        }
    });
});

app.post("/check-sub", (req, res) => {
    const { txtEmail } = req.body;
    
    if (!txtEmail || !validateEmail(txtEmail)) {
        return res.status(400).send("Valid email is required");
    }

    const query = "SELECT * FROM iprofile WHERE emailid=?";
    pool.query(query, [sanitizeInput(txtEmail)], (err, result) => {
        if (err) {
            return handleDatabaseError(err, res, "Subscription check failed");
        }
        res.json(result);
    });
});

// Static File Routes
const staticRoutes = [
    { path: "/infl-Dash", file: "infl-Dash.html" },
    { path: "/inf-Profile", file: "inf-Profile.html" },
    { path: "/Admin-dash.html", file: "Admin-dash.html" },
    { path: "/index2.html", file: "index2.html" },
    { path: "/Admin-pwd.html", file: "Admin-pwd.html" },
    { path: "/goToAdminusers", file: "admin-users.html" },
    { path: "/goToAdminAllInflu", file: "admin-all-influ.html" },
    { path: "/influ-finder.html", file: "influ-finder.html" },
    { path: "/events-manager", file: "events-manager.html" },
    { path: "/client-profile", file: "client-profile.html" }
];

staticRoutes.forEach(route => {
    app.get(route.path, (req, res) => {
        res.sendFile(path.join(__dirname, "public", route.file));
    });
});

// Image Routes
const imageRoutes = [
    "profile.png", "bookings.png", "settings.png", "login.png"
];

imageRoutes.forEach(image => {
    app.get(`/pics/${image}`, (req, res) => {
        res.sendFile(path.join(__dirname, "pics", image));
    });
});

// Error Handling Middleware
app.use((err, req, res, next) => {
    console.error("Unhandled error:", err);
    res.status(500).send("Internal server error");
});

// 404 Handler
app.use((req, res) => {
    res.status(404).send("Page not found");
});

// Graceful shutdown
process.on('SIGINT', () => {
  pool.end(() => {
    console.log('Database pool closed');
    process.exit(0);
  });
});

// Server Start
app.listen(PORT, () => {
    console.log(`Server started successfully on port ${PORT}`);
});

// Graceful Shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    mysql.end(() => {
        console.log('Database connection closed.');
        process.exit(0);
    });
});