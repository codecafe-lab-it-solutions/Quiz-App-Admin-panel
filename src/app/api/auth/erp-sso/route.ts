import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleApiError, ok } from "@/lib/api-response";
import { signAccessToken, signRefreshToken, tokenPayloadFromUser } from "@/lib/auth";
import { claimsMatchAccount, verifyErpSsoToken } from "@/lib/erp-sso";
import { findLoginByIdentifier, getFacultyByRoll, getStudentByRoll } from "@/lib/legacy-db";
import { setAuthCookies } from "@/lib/cookies";

// Single sign-on from the RGIPT ERP/CRM - see lib/erp-sso.ts for the token
// format. Resolves the (already ERP-authenticated) user to their student or
// faculty account and starts a normal session, no password involved. Admin
// accounts are intentionally not reachable this way.
async function signInWithToken(token: string) {
  const claims = verifyErpSsoToken(token);

  // Same generic message for every account-level failure so this can't be
  // used to probe which rolls exist.
  const denied = () => new ApiError(401, "Could not sign you in. Please log in with your password.");

  const studentLogin = await findLoginByIdentifier(claims.roll, "STU");
  const login = studentLogin ?? (await findLoginByIdentifier(claims.roll, "FAC"));
  if (!login || login.userRoll.toLowerCase() !== claims.roll.toLowerCase()) throw denied();
  if (login.status !== 1) throw new ApiError(403, "This account has been deactivated. Contact the admin office.");

  if (studentLogin) {
    const student = await getStudentByRoll(login.userRoll);
    if (!student || !claimsMatchAccount(claims, { email: student.email, mobile: student.mobile })) throw denied();
    return {
      role: "student" as const,
      redirectTo: "/student",
      payload: tokenPayloadFromUser({ id: student.roll, email: student.email, name: student.name }, "student"),
      user: { roll: student.roll, name: student.name, email: student.email, batch: student.batch, semNow: student.semNow },
    };
  }

  const faculty = await getFacultyByRoll(login.userRoll);
  if (!faculty || !claimsMatchAccount(claims, { email: faculty.email, mobile: faculty.mobile })) throw denied();
  return {
    role: "faculty" as const,
    redirectTo: "/faculty",
    payload: tokenPayloadFromUser({ id: faculty.roll, email: faculty.email, name: faculty.name }, "faculty"),
    user: { roll: faculty.roll, name: faculty.name, email: faculty.email },
  };
}

// Browser flow (the CRM "Login with Quiz Panel" button): the user lands here
// with ?token=..., gets their session cookies and is sent to their dashboard.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  try {
    if (!token) throw new ApiError(400, "Missing token");
    const session = await signInWithToken(token);

    const accessToken = signAccessToken(session.payload);
    const refreshToken = signRefreshToken(session.payload);

    // Relative Location - the app sits behind a reverse proxy, so building an
    // absolute URL from req.url could point at the internal host/port.
    const response = new NextResponse(null, { status: 302, headers: { Location: session.redirectTo } });
    setAuthCookies(response, accessToken, refreshToken);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    // Config problems are worth a real status; everything else goes back to
    // the login page rather than showing the user raw JSON.
    if (error instanceof ApiError && error.status === 503) return handleApiError(error);
    return new NextResponse(null, { status: 302, headers: { Location: "/login?sso=failed", "Cache-Control": "no-store" } });
  }
}

const bodySchema = z.object({ token: z.string().min(1) });

// Server-to-server / API flow: same token, returns the JWTs as JSON (and sets
// the cookies) instead of redirecting.
export async function POST(req: NextRequest) {
  try {
    const { token } = bodySchema.parse(await req.json());
    const session = await signInWithToken(token);

    const accessToken = signAccessToken(session.payload);
    const refreshToken = signRefreshToken(session.payload);

    const response = ok({ accessToken, refreshToken, role: session.role, redirectTo: session.redirectTo, user: session.user });
    setAuthCookies(response, accessToken, refreshToken);
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
