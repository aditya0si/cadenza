import mongoose, { Schema, model, type InferSchemaType, type Model } from 'mongoose';

const messageSchema = new Schema(
  {
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: 1000 },
    /** Idempotency key from the emitting client. */
    eventId: { type: String, required: true },
  },
  { timestamps: true, collection: 'messages' },
);

// Chat history is always read newest-first for one room.
messageSchema.index({ roomId: 1, createdAt: -1 });
messageSchema.index({ roomId: 1, eventId: 1 }, { unique: true });

export type MessageDocument = InferSchemaType<typeof messageSchema>;
export type MessageModel = Model<MessageDocument>;

export const Message: MessageModel = (mongoose.models.Message as MessageModel | undefined) ?? model<MessageDocument>('Message', messageSchema);
