const axios = require('axios');
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

// Database reference
const dbRef = admin.firestore().doc('tokens/demo');

// Twitter API init
const TwitterApi = require('twitter-api-v2').default;
const twitterClient = new TwitterApi({
  clientId: 'WHVTbk0xN2owWUszQW1TZXplNng6MTpjaQ',
  clientSecret: 'Cpttsl1weeqsY_ZflPqGboBjgf-eSoBLl2Hn3GYwfdq--tC60k',
});

const callbackURL = 'http://127.0.0.1:5000/books-quotes-c60b7/us-central1/callback';

// STEP 1 - Auth URL
exports.auth = functions.https.onRequest(async (request, response) => {
  const { url, codeVerifier, state } = twitterClient.generateOAuth2AuthLink(callbackURL, {
    scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
  });

  // store verifier
  await dbRef.set({ codeVerifier, state });

  response.redirect(url);
});

// step 2
exports.callback = functions.https.onRequest(async (request, response) => {
  const { state, code } = request.query;

  const dbSnapshot = await dbRef.get();
  const { codeVerifier, state: storedState } = dbSnapshot.data();

  if (state !== storedState) {
    return response.status(400).send('Stored tokens do not match!');
  }

  const {
    client: loggedClient,
    accessToken,
    refreshToken,
  } = await twitterClient.loginWithOAuth2({
    code,
    codeVerifier,
    redirectUri: callbackURL,
  });

  await dbRef.set({ accessToken, refreshToken });

  const { data } = await loggedClient.v2.me(); // start using the client if you want

  response.send(data);
});

// step 3
exports.tweet = functions.https.onRequest(async (request, response) => {
  const { refreshToken } = (await dbRef.get()).data();

  const {
    client: refreshedClient,
    accessToken,
    refreshToken: newRefreshToken,
  } = await twitterClient.refreshOAuth2Token(refreshToken);

  await dbRef.set({ accessToken, refreshToken: newRefreshToken });

  let nextTweet = await axios.get('https://api.hamatim.com/quote');

  while (!nextTweet.data.book || nextTweet.data.text === '"' || nextTweet.data.text.length > 280)
    nextTweet = await axios.get('https://api.hamatim.com/quote');

  const { data } = await refreshedClient.v2.tweet(nextTweet.data.text);

  const { data: DataReply } = await refreshedClient.v2.reply(
    `${nextTweet.data.book} - ${nextTweet.data.author}`,
    data.id
  );

  // const { data } = await refreshedClient.v2.tweet('“You are one of the stories I ended before I write a single word.”');

  // const { data: DataReply } = await refreshedClient.v2.reply(`Love, Spelled in Poetry - Helena Natasha`, data.id);

  response.send(data);
});
