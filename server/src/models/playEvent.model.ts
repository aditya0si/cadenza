import mongoose, { Schema, model, type InferSchemaType, type Model } from 'mongoose';

/** One row per (song, listener, session) — the raw material for /api/stats/*. */
const playEventSchema = new Schema(
  {
    songId: { type: Schema.Types.ObjectId, ref: 'Song', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', default: null },
    source: { type: String, enum: ['library', 'album', 'playlist', 'search', 'room'], required: true },
    msPlayed: { type: Number, default: 0, min: 0 },
    startedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true, collection: 'play_events' },
);

// "plays over the last N days", "top tracks" and "listens per song" queries.
playEventSchema.index({ startedAt: -1 });
playEventSchema.index({ songId: 1, startedAt: -1 });
playEventSchema.index({ roomId: 1, startedAt: -1 });

export type PlayEventDocument = InferSchemaType<typeof playEventSchema>;
export type PlayEventModel = Model<PlayEventDocument>;

export const PlayEvent: PlayEventModel =
  (mongoose.models.PlayEvent as PlayEventModel | undefined) ?? model<PlayEventDocument>('PlayEvent', playEventSchema);
