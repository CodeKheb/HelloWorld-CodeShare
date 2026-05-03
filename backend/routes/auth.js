import dotenv from "dotenv";
dotenv.config();
import { Router } from "express";
import cookieParser from "cookie-parser";
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";

const authRouter = Router();

authRouter.use(cookieParser())
authRouter.use(passport.initialize())
authRouter.use(passport.session())


passport.use(new GitHubStrategy(
{
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: process.env.GITHUB_CALLBACK,
},

(accessToken, refreshToken, profile, done) => {
    // You can save user to DB here later
    return done(null, {
        id: profile.id,
        username: profile.username,
        displayName: profile.displayName,
        avatar: profile.photos?.[0]?.value,
        accessToken
    });
}
));

authRouter.get("/auth", async (req, res) => {
    try {
        res.send("/auth")
    } catch (error) {
        return res.json({error})
    }
})

authRouter.get("/success", async (req, res) => {
    try {
        res.send("/success!")
    } catch (error) {
        return res.json({error})
    }
})

authRouter.get("/user", async (req, res) => {
    try {
        const sessionCookie = req.cookies.session;

        if (!sessionCookie) {
            return res.status(401).json({ authenticated: false, message: "You are not AUTHENTICATED" });
        }

        return res.json({ authenticated: true, message: "User working", user: req.user });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
})

// Redirect to GitHub
authRouter.get("/github",
    passport.authenticate("github", { scope: ["user:email"] })
);

// Callback URL
authRouter.get("/github/callback",
    passport.authenticate("github", {
        failureRedirect: "/login",
    }),
    (req, res) => {
        // success login
        res.redirect("/");
    }
);

export default authRouter;
