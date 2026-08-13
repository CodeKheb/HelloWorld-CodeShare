import express from "express";
import session from "express-session";
const app = express();
app.set("trust proxy", 1);
app.use(session({
  secret: "test", resave: false, saveUninitialized: false, proxy: true,
  cookie: { httpOnly: true, secure: "auto", sameSite: "lax", maxAge: 86400000 }
}));
app.get("/set", (req, res) => { req.session.foo = "bar"; res.send("ok"); });
app.get("/check", (req, res) => res.json({ authed: !!req.session.foo }));
app.listen(3999, () => console.log("up"));
