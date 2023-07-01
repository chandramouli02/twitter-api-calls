const express = require("express");
const app = express();
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
app.use(express.json());
const path = require("path");
const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const initializeDBAndServer = async () => {
  try {
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    app.listen(3000, () => {
      console.log("server listening at port: 3000");
    });
  } catch (e) {
    console.log(e.message);
    process.exitCode(1);
  }
};

initializeDBAndServer();

const authenticateToken = async (request, response, next) => {
  const authHeader = await request.headers["authorization"];
  const jwtToken = authHeader.split(" ")[1]; //barer token..send it while requesting..
  //console.log(jwtToken);
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "GOOD_GOING", function (err, payload) {
      if (err) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

app.get("/users/", authenticateToken, async (request, response) => {
  const getUsersArrayQuery = `
    select * from user;`;
  response.send(await db.all(getUsersArrayQuery));
});
//tables: user, follower, tweet, reply, like
//api1 add user..
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const getUserQuery = `select * from user where username = '${username}';`;
  const dbUser = await db.get(getUserQuery);
  if (dbUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    const ValidPassword = password.length > 6;
    if (!ValidPassword) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const addUserQuery = `
            INSERT INTO user (username, password, name, gender)
            VALUES 
            ('${username}', '${hashedPassword}', '${name}', '${gender}');`;
      await db.run(addUserQuery);
      response.send("User created successfully");
    }
  }
});

//delete user by id
app.delete("/users/:userId", authenticateToken, async (request, response) => {
  const { userId } = request.params;
  const deleteUserQuery = `
    delete from user
    where user_id = ${userId}`;
  await db.run(deleteUserQuery);
  response.send("User Deleted Successfully");
});

//api2 login api verify username and password..
//creates jwtToken..
app.post("/login/", async (request, response, next) => {
  const { username, password } = request.body;
  //check user in db
  const getUserQuery = `select * from user where username = '${username}'`;
  const dbUser = await db.get(getUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    //some user exists..so check for password..
    const isPasswordMatches = await bcrypt.compare(password, dbUser.password);
    if (!isPasswordMatches) {
      response.status(400);
      response.send("Invalid password");
    } else {
      //if matches.. create jwt token for further uses..
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "GOOD_GOING");
      console.log(jwtToken);
      response.send({ jwtToken });
      next();
    }
  }
});

//api3 gets the latest tweets of the users whom the user follows..
//limit 4.
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  //console.log(request.username);
  const username = request.username;
  const getUserQuery = `select user_id from user where username = '${username}';`;
  let userId = await db.get(getUserQuery);
  userId = userId.user_id;
  const tweetsForUser = `
  select user.username, T.tweet, T.date_time from 
  (follower cross join tweet
  on follower.follower_id = tweet.user_id) as T inner join user
  on t.following_user_id
  where T.following_user_id = ${userId}
  order by T.date_time
  limit 4;
  `;
  const dbResponse = await db.all(tweetsForUser);
  response.send(dbResponse);
});

//api4 list of people whom the user follows..
app.get("/user/following/", authenticateToken, async (request, response) => {
  const username = request.username;
  const getUserQuery = `select user_id from user where username = '${username}';`;
  let userId = await db.get(getUserQuery);
  userId = userId.user_id;
  const getFollowingArray = `
  select u.name from follower as f inner join
  user as u on f.follower_user_id = u.user_id
  where f.follower_user_id = ${userId};`;
  const dbResponse = await db.all(getFollowingArray);
  response.send(dbResponse);
});

//api5 list of people who follows user..
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const username = request.username;
  const getUserQuery = `select user_id from user where username = '${username}';`;
  let userId = await db.get(getUserQuery);
  userId = userId.user_id;

  const getFollowersArray = `
    select u.name from follower as f inner join
    user as u on f.following_user_id = ${2};`;
  const dbResponse = await db.all(getFollowersArray);
  response.send(dbResponse);
});
//middleware fro checking if user requests the tweet
//whom he follows or not.
const checkUserIfFollowsTweetedUser = async (userId, tweetId) => {
  //check If UserFollows the requestedTweetUser or not..
  //1.get id of user who posted the tweet
  //2.check if user follows the tweetPostedUser or not..
  const canRequestTweetUsers = `select follower_user_id as followersId from follower where following_user_Id = (
    select user_id from tweet where tweet_id = ${tweetId}
    ) `;
  const canReqTweetUsersArray = await db.all(canRequestTweetUsers);
  //checks if requested user id in this obj..
  for (let user of canReqTweetUsersArray) {
    console.log(user.followersId);
    if (user.followersId === userId) {
      return true;
      break;
    }
  }
  return false;
};

//api6 get requested tweets by id
//and check if user follows the tweetPosted user or not..
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const username = request.username;
  const getUserQuery = `select user_id from user where username = '${username}';`;
  let userId = await db.get(getUserQuery);
  userId = userId.user_id;
  const { tweetId } = request.params;
  const isRequestValid = await checkUserIfFollowsTweetedUser(userId, tweetId);
  if (!isRequestValid) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const getTweetById = `
      select  t.tweet, sum(l.like_id) as likes, 
      sum(r.reply_id) as replies, t. date_time as dateTime
      from tweet as t natural join 
      reply as r 
      natural join like as l
      where t.tweet_id = ${tweetId};`;
    const dbResponse = await db.get(getTweetById);
    response.send(dbResponse);
  }
});
//function to make obj values as list..
const objectValuesToList = (obj) => {
  let list = [];
  for (let item of obj) {
    list.push(item.username);
  }
  return list;
};
//api7
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const username = request.username;
    const getUserQuery = `select user_id from user where username = '${username}';`;
    let userId = await db.get(getUserQuery);
    userId = userId.user_id;
    const { tweetId } = request.params;
    const isRequestValid = await checkUserIfFollowsTweetedUser(userId, tweetId);
    if (!isRequestValid) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      //listOf username who liked that tweet..
      const getUserNamesWhoLikedQuery = `
        select u.username from (tweet as t 
        inner join like as l
        on t.tweet_id = l.tweet_id)
        left join user as u on  l.user_id = u.user_id
        where t.tweet_id = ${tweetId};`;
      const dbResponse = await db.all(getUserNamesWhoLikedQuery);
      const listOfLikedUsers = objectValuesToList(dbResponse);
      const responseLikes = {
        likes: listOfLikedUsers,
      };
      response.send(responseLikes);
    }
  }
);

//api8 get the replies of the tweet
//check for the useRequesting if he follows the user..
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const username = request.username;
    const getUserQuery = `select user_id from user where username = '${username}';`;
    let userId = await db.get(getUserQuery);
    userId = userId.user_id;
    const { tweetId } = request.params;
    const isRequestValid = await checkUserIfFollowsTweetedUser(userId, tweetId);
    if (!isRequestValid) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      //listOf username who liked that tweet..
      const getUserNamesWhoRepliedQuery = `
        select u.name, r.reply from (tweet as t 
        inner join reply as r
        on t.tweet_id = r.tweet_id)
        left join user as u on  r.user_id = u.user_id
        where t.tweet_id = ${tweetId};`;
      const dbResponse = await db.all(getUserNamesWhoRepliedQuery);
      const responseReplies = {
        replies: dbResponse,
      };
      response.send(responseReplies);
    }
  }
);
//get all tweets by userId..
app.get(
  "/user/:userId/tweets/",
  authenticateToken,
  async (request, response) => {
    const { userId } = request.params;
    console.log(userId);
    const getTweetsOfUser = `
    select * from tweet
    where user_id = ${userId};`;
    const dbResponse = await db.all(getTweetsOfUser);
    response.send(dbResponse);
  }
);
//api9 get all tweets of user
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const username = request.username;
  const getUserQuery = `select user_id from user where username = '${username}';`;
  let userId = await db.get(getUserQuery);
  userId = userId.user_id;
  console.log(userId);
  //tweet likes, replies, dateTime
  const getTweetsQuery = `
  select
  t.tweet,
  sum(l.like_id) as likes,
  sum(r.reply_id) as replies,
  t.date_time as dateTime
  from tweet as t
  inner join like as l on t.tweet_id = l.tweet_id
  inner join reply as r on t.tweet_id = l.tweet_id
  where t.user_id = ${userId}
  group by t.tweet
  order by dateTime;`;

  const tweetsArray = await db.all(getTweetsQuery);
  response.send(tweetsArray);
});

//api10 post a tweet
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const username = request.username;
  const getUserQuery = `select user_id from user where username = '${username}';`;
  let userId = await db.get(getUserQuery);
  userId = userId.user_id;
  const { tweet } = request.body;
  const dateTime = new Date(); //get it at the time the user posts..
  const createTweetQuery = `
  insert into tweet(tweet,user_id,date_time)
  values(
      '${tweet}',
      ${userId},
      '${dateTime}'
  );`;
  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});
//api11 delete tweet by id
//if user tries to delete another users tweets throw err.
app.delete("/tweets/:tweetId", authenticateToken, async (request, response) => {
  const username = request.username;
  //console.log(username);
  const getUserQuery = `select user_id from user where username = '${username}';`;
  let userId = await db.get(getUserQuery);
  userId = userId.user_id;
  //console.log(userId);
  const { tweetId } = request.params;
  //tweeted user
  const tweetedUser = `select user_id from tweet 
  where tweet_id = ${tweetId};`;
  const tweetedUserId = await db.get(tweetedUser);
  //console.log(tweetedUserId);
  let canDelete;
  if (tweetedUserId !== undefined) {
    canDelete = userId === tweetedUserId.user_id;
  } else {
    canDelete = false;
  }

  if (canDelete === false) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const deleteTweetQuery = `
    delete from tweet 
    where tweet_id = ${tweetId};`;
    await db.run(deleteTweetQuery);
    response.send("Tweet Removed");
  }
});

module.exports = app;
