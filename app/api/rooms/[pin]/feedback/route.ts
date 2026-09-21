import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { scheduleRosterFlush } from "@/lib/bus";
import { findParticipantByResumeToken, getRoom, submitFeedback } from "@/lib/rooms";
import { feedbackSchema } from "@/lib/validation";

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

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "รูปแบบคำขอไม่ถูกต้อง" } }, { status: 400 });
	}

	const parsed = feedbackSchema.safeParse(body);
	if (!parsed.success) {
		// Field names only — never the text itself, which is a participant's own words.
		const fields = parsed.error.issues.map((issue) => issue.path.join(".") || "(root)");
		return NextResponse.json(
			{ error: { code: "VALIDATION_ERROR", message: "ความคิดเห็นยาวเกินไป", fields } },
			{ status: 400 },
		);
	}

	submitFeedback(participant, parsed.data.feedback);

	// So a host already sitting on the ended screen sees it arrive without a refresh.
	scheduleRosterFlush(room);

	return NextResponse.json({ ok: true });
}
