import mongoose, { Schema, model, type InferSchemaType, type Model } from 'mongoose';

const albumSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, unique: true, trim: true },
    artistId: { type: Schema.Types.ObjectId, ref: 'Artist', required: true, index: true },
    releaseYear: { type: Number, required: true, min: 1900, max: 2100 },
    coverKey: { type: String, required: true },
    songCount: { type: Number, default: 0, min: 0 },
    description: { type: String, default: null, maxlength: 600 },
  },
  { timestamps: true, collection: 'albums' },
);

albumSchema.index({ releaseYear: -1 });
albumSchema.index({ title: 'text', description: 'text' }, { weights: { title: 10, description: 2 }, name: 'album_text' });

export type AlbumDocument = InferSchemaType<typeof albumSchema>;
export type AlbumModel = Model<AlbumDocument>;

export const Album: AlbumModel = (mongoose.models.Album as AlbumModel | undefined) ?? model<AlbumDocument>('Album', albumSchema);
