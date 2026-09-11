import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { scheduleRosterFlush } from "@/lib/bus";
import { findParticipantByResumeToken, getRoom, submitAnswer } from "@/lib/rooms";
import { answerSchema } from "@/lib/validation";

export async function POST(request: Request, { params }: { params: Promise<{ pin: string }> }) {
	const { pin } = await params;
	const cookieStore = await cookies();
	const token = cookieStore.get("resume_token")?.value;

	const room = getRoom(pin);
	if (!room) {
		return NextResponse.json({ error: { code: "ROOM_NOT_FOUND", message: "ไม่พบห้องนี้" } }, { status: 404 });
	}

	const participant = token ? findParticipantByResumeToken(room, token) : undefined;
	if (!participant) {
		return NextResponse.json(
			{ error: { code: "PARTICIPANT_NOT_FOUND", message: "ไม่พบข้อมูลผู้เข้าร่วมของคุณ" } },
			{ status: 404 },
		);
	}

	// Parsed separately from schema validation: a body that isn't JSON at all and a body whose
	// fields are wrong are different failures, and collapsing them into one opaque 400 made this
	// endpoint impossible to diagnose from either side of the wire.
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "รูปแบบคำขอไม่ถูกต้อง" } }, { status: 400 });
	}

	console.log(`[answers] ${participant.name} (${participant.id}) submitted answer for room ${room.pin}:`, body);
	const parsed = answerSchema.safeParse(body);
	if (!parsed.success) {
		// Field names only — never the submitted values, which are participant answers.
		const fields = parsed.error.issues.map((issue) => issue.path.join(".") || "(root)");
		if (process.env.NODE_ENV !== "production") {
			console.warn(`[answers] rejected payload; invalid fields: ${fields.join(", ")}`);
		}
		return NextResponse.json(
			{ error: { code: "VALIDATION_ERROR", message: "ข้อมูลคำตอบไม่ถูกต้อง", fields } },
			{ status: 400 },
		);
	}

	const result = submitAnswer(room, participant, parsed.data.questionIndex, parsed.data.value);
	if ("error" in result) {
		return NextResponse.json({ error: result.error }, { status: result.status });
	}

	scheduleRosterFlush(room);

	return NextResponse.json({ ok: true });
}
