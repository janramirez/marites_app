"use server";

import { revalidatePath } from "next/cache";

import { connectToDB } from "../mongoose";

import User from "../models/user.model";
import Thread from "../models/thread.model";
import Community from "../models/community.model";

export async function fetchPosts(pageNumber = 1, pageSize = 20) {
    connectToDB();

    // Calculate number of posts to skip
    const skipAmount = (pageNumber - 1) * pageSize;

    // Fetch the posts that have no parents (top-level threads...)
    const postsQuery = Thread.find({ parentId: { $in: [null, undefined] } })
        .sort({ createdAt: "desc" })
        .skip(skipAmount)
        .limit(pageSize)
        .populate({ path: "author", model: User })
        .populate({
            path: "community",
            model: Community,
        })
        .populate({
            path: "children",
            populate: {
                path: "author",
                model: User,
                select: "_id name parentId image",
            },
        });

    const totalPostsCount = await Thread.countDocuments({
        parentId: { $in: [null, undefined] },
    });

    const posts = await postsQuery.exec();

    const isNext = totalPostsCount > skipAmount + posts.length;

    return { posts, isNext };
}

interface Params {
    text: string;
    author: string;
    communityId: string | null;
    path: string;
}

export async function createThread({ text, author, communityId, path }: Params) {
    try {
        connectToDB();

        const communityIdObject = await Community.findOne(
            { id: communityId },
            { _id: 1 }
        )

        const createdThread = await Thread.create({
            text,
            author,
            community: communityIdObject,
        });

        console.log(createdThread);

        // Update user model
        await User.findByIdAndUpdate(author, {
            $push: { threads: createdThread._id },
        });

        if(communityIdObject) {
            await Community.findByIdAndUpdate(communityIdObject, {
                $push: { threads: createdThread._id },
            });
        }

        revalidatePath(path);
    } catch (error: any) {
        throw new Error(`Failed to create thread: ${error.message}`);
    }
}

// fetchAllChildThreads()
// TODO: deleteThread()

export async function fetchThreadById(id: string) {
    connectToDB();

    try {
        // TODO: Populate Community
        const thread = await Thread.findById(id)
            .populate({
                path: "author",
                model: User,
                select: "_id id name image",
            })
            .populate({
                path: "community",
                model: Community,
                select: "_id id name image",
            })
            .populate({
                path: "children",
                populate: [
                    {
                        path: "author",
                        model: User,
                        select: "_id id name parentId image",
                    },
                    {
                        path: "children",
                        model: Thread,
                        populate: {
                            path: "author",
                            model: User,
                            select: "_id id name parentId image",
                        },
                    },
                ],
            })
            .exec();

        return thread;
    } catch (error: any) {
        throw new Error(`Error while fetching thread: ${error.message}`);
    }
}

export async function addCommentToThread(
    threadId: string,
    commentText: string,
    userId: string,
    path: string
) {
  connectToDB();

  try {
    // Find original thread by Id
    const originalThread = await Thread.findById(threadId);

    if(!originalThread) {
      throw new Error("Thread not found")
    }

    // Create a new thread with the comment text
    const commentThread = new Thread({
      text: commentText,
      author: userId,
      parentId: threadId,
    })

    // Save the new thread
    const savedCommentThread = await commentThread.save();

    // Update original thread to include new comment
    originalThread.children.push(savedCommentThread._id);

    // Save original thread
    await originalThread.save();

    // Update view
    revalidatePath(path);

  } catch (error: any) {
    console.error("Error while adding comment: ", error);
    throw new Error(`Error adding comment to thread: ${error.message}`)
  }
}
