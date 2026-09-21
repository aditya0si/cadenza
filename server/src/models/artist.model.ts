import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose';

const artistSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, trim: true },
    bio: { type: String, required: true, maxlength: 600 },
    imageKey: { type: String, required: true },
    genres: { type: [String], default: [] },
    monthlyListeners: { type: Number, default: 0, min: 0 },
    origin: { type: String, default: null },
  },
  { timestamps: true, collection: 'artists' },
);

// Browse ("all artists, A→Z") and search ("artists matching a phrase") are the
// two real query paths, so both get an index.
artistSchema.index({ name: 1 });
artistSchema.index({ name: 'text', bio: 'text', genres: 'text' }, { weights: { name: 10, genres: 3, bio: 1 }, name: 'artist_text' });

export type ArtistDocument = InferSchemaType<typeof artistSchema>;
export type ArtistModel = Model<ArtistDocument>;

export const Artist: ArtistModel = (models.Artist as ArtistModel | undefined) ?? model<ArtistDocument>('Artist', artistSchema);
