import mongoose, { Schema, model, type InferSchemaType, type Model } from 'mongoose';

const songSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, unique: true, trim: true },
    artistId: { type: Schema.Types.ObjectId, ref: 'Artist', required: true, index: true },
    albumId: { type: Schema.Types.ObjectId, ref: 'Album', default: null },
    trackNumber: { type: Number, default: 1, min: 1 },
    durationMs: { type: Number, required: true, min: 1 },
    /** 120 normalised amplitude buckets used to draw the waveform scrubber. */
    waveformPeaks: { type: [Number], default: [] },
    /** Path of the audio file relative to MEDIA_DIR — never exposed raw to clients. */
    audioKey: { type: String, required: true },
    coverKey: { type: String, required: true },
    bpm: { type: Number, default: null, min: 20, max: 300 },
    musicalKey: { type: String, default: null },
    genres: { type: [String], default: [] },
    playCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, collection: 'songs' },
);

songSchema.index({ albumId: 1, trackNumber: 1 });
songSchema.index({ playCount: -1 });
songSchema.index(
  { title: 'text', genres: 'text' },
  { weights: { title: 10, genres: 3 }, name: 'song_text' },
);

export type SongDocument = InferSchemaType<typeof songSchema>;
export type SongModel = Model<SongDocument>;

export const Song: SongModel = (mongoose.models.Song as SongModel | undefined) ?? model<SongDocument>('Song', songSchema);
