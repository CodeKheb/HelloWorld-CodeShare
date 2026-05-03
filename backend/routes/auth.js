import { Router } from "express";
import cookieParser from "cookie-parser";
import passport from "passport";
//import GitHubStrategy from "passport-github";

const authRouter = Router();

authRouter.use(cookieParser)
authRouter.use(passport.initialize())
authRouter.use(passport.session())

// passport.use(new GitHubStrategy({
//     clientID: process.env.GITHUB_CLIENT_ID,
//     clientSecret: process.env.GITHUB_SECRET,
//     callbackURL: process.env.GITHUB_AUTH_CALLBACK,
//     scope: ["repo", "repo_deployment"],
// }, (accessToken, refreshToken, profile, done) => {
    
// }
// ))

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
        res.json({message: "User working"})
        const sessionCookie = req.cookies.session;

        if (!sessionCookie) {
            return res.send("You are not AUTHENTICATED")
        }
    } catch (error) {
       return res.json({error})
    }
})

export default authRouter;