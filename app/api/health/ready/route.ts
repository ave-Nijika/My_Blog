import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { status: "ready", database: "connected", timestamp: new Date().toISOString() },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      { 
        status: "not_ready", 
        database: "disconnected", 
        timestamp: new Date().toISOString()
      },
      { status: 503 }
    );
  }
}