import mongoose, { Schema, model, type InferSchemaType, type Model } from 'mongoose';

const memberSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['host', 'member'], default: 'member' },
    joinedAt: { type: Date, default: () => new Date() },
    lastSeenAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const queueEntrySchema = new Schema(
  {
    songId: { type: Schema.Types.ObjectId, ref: 'Song', required: true },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    addedAt: { type: Date, default: () => new Date() },
    /** Client-supplied idempotency key: a replayed add never duplicates a track. */
    eventId: { type: String, required: true },
  },
  { _id: false },
);

const playbackSchema = new Schema(
  {
    trackId: { type: Schema.Types.ObjectId, ref: 'Song', default: null },
    isPlaying: { type: Boolean, default: false },
    positionMs: { type: Number, default: 0, min: 0 },
    /** Server clock reading that `positionMs` refers to — the authoritative anchor. */
    serverTs: { type: Date, default: () => new Date() },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false },
);

const roomSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, trim: true },
    hostId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    visibility: { type: String, enum: ['public', 'private'], default: 'public' },
    members: { type: [memberSchema], default: [] },
    queue: { type: [queueEntrySchema], default: [] },
    playback: { type: playbackSchema, default: () => ({}) },
    lastActivityAt: { type: Date, default: () => new Date() },
    /** Recently processed client event ids, so a flaky reconnect cannot double-apply. */
    processedEventIds: { type: [String], default: [] },
  },
  { timestamps: true, collection: 'rooms' },
);

roomSchema.index({ visibility: 1, lastActivityAt: -1 });
roomSchema.index({ 'members.userId': 1 });

export type RoomDocument = InferSchemaType<typeof roomSchema>;
export type RoomModel = Model<RoomDocument>;

export const Room: RoomModel = (mongoose.models.Room as RoomModel | undefined) ?? model<RoomDocument>('Room', roomSchema);
