import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose';

/** A person who signs in through Clerk (or a demo session) and owns playlists/rooms. */
const userSchema = new Schema(
  {
    clerkId: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    displayName: { type: String, required: true, trim: true, maxlength: 80 },
    avatarUrl: { type: String, default: null },
    bio: { type: String, default: null, maxlength: 400 },
    roles: {
      type: [String],
      enum: ['listener', 'artist', 'admin'],
      default: ['listener'],
    },
    lastSeenAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true, collection: 'users' },
);

userSchema.index({ roles: 1 });

export type UserDocument = InferSchemaType<typeof userSchema>;
export type UserModel = Model<UserDocument>;

export const User: UserModel = (models.User as UserModel | undefined) ?? model<UserDocument>('User', userSchema);
