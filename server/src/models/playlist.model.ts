import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose';

const playlistEntrySchema = new Schema(
  {
    songId: { type: Schema.Types.ObjectId, ref: 'Song', required: true },
    addedAt: { type: Date, default: () => new Date() },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false },
);

const playlistSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 600 },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    songs: { type: [playlistEntrySchema], default: [] },
    visibility: { type: String, enum: ['private', 'public'], default: 'private' },
  },
  { timestamps: true, collection: 'playlists' },
);

// Library page ("my playlists") and discovery ("public playlists") are the two
// hot paths.
playlistSchema.index({ ownerId: 1, updatedAt: -1 });
playlistSchema.index({ visibility: 1, updatedAt: -1 });

export type PlaylistDocument = InferSchemaType<typeof playlistSchema>;
export type PlaylistModel = Model<PlaylistDocument>;

export const Playlist: PlaylistModel =
  (models.Playlist as PlaylistModel | undefined) ?? model<PlaylistDocument>('Playlist', playlistSchema);
