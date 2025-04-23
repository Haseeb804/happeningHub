const express = require('express');
const { ApolloServer, gql } = require('apollo-server-express');
const neo4j = require('neo4j-driver');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const secretKey = crypto.randomBytes(32).toString('hex');
const { sendInvitationEmail } = require('./emailService');

const { initiatePasswordReset, verifyResetCode, updatePassword } = require('./passwordResetController');
const rateLimit = require('express-rate-limit');

// Add rate limiting middleware
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // limit each IP to 3 requests per windowMs
  message: 'Too many password reset requests from this IP, please try again later'
});

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());

// Connect to Neo4j
const driver = neo4j.driver(
  "neo4j+s://6a085d76.databases.neo4j.io",
  neo4j.auth.basic("neo4j", "izJqlkQOEz7LAhq48u6TrmhISEqiK21XjfHMMrzOZiw")
);

// Country API configuration with caching and fallback
let countriesCache = null;
let lastFetchTime = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours cache

async function fetchCountriesWithFallback() {
  const now = Date.now();
  
  if (countriesCache && (now - lastFetchTime) < CACHE_DURATION) {
    return countriesCache;
  }

  try {
    const response = await axios.get('https://restcountries.com/v3.1/all?fields=name,cca2,flags');
    const countries = response.data.map(country => ({
      name: country.name.common,
      code: country.cca2,
      flag: country.flags.png
    }));

    countriesCache = countries;
    lastFetchTime = now;
    return countries;
  } catch (primaryError) {
    console.error('Primary countries API failed, trying fallback:', primaryError.message);
    
    try {
      const fallbackResponse = await axios.get('https://countriesnow.space/api/v0.1/countries/flag/images');
      const countries = fallbackResponse.data.data.map(country => ({
        name: country.name,
        code: country.iso2,
        flag: country.flag
      }));

      countriesCache = countries;
      lastFetchTime = now;
      return countries;
    } catch (fallbackError) {
      console.error('All country APIs failed:', fallbackError.message);
      return countriesCache || [];
    }
  }
}

// Updated GraphQL Schema with all endpoints
const typeDefs = gql`
  type User {
    id: ID!
    name: String!
    email: String!
    age: Int
    role: String!
    contactNo: String
    skills: [String]
    interests: [String]
    designation: String
    affiliation: String
    expertise: String
    countryCode: String
  }



  type Venue {
    name: String!
    url: String
    address: String
  }

  type Event {
    id: ID!
    title: String!
    description: String!
    date: String!
    time: String!
    category: String!
    interest: String!
    creatorEmail: String!
    creatorName: String!
    venue: Venue!
    createdAt: String!
    status: String!
    speakers: [Speaker]
    attendees: [User]
  }

  type Speaker {
    email: String!
    name: String!
    status: String!
    expertise: String!
    affiliation: String!
  }

  type SpeakerInvitation {
    id: ID!
    eventId: ID!
    speakerEmail: String!
    status: String!
    isRead: Boolean!
    createdAt: String!
    event: Event
  }

  type Notification {
    id: ID!
    type: String!
    message: String!
    eventId: ID
    isRead: Boolean!
    createdAt: String!
  }

  type Country {
    name: String!
    code: String!
    flag: String
  }

  type EventFeedback {
    id: ID!
  eventId: ID!
  attendeeEmail: String!
  attendeeName: String!
  rating: Int!
  overallFeedback: String
  wouldAttendAgain: Boolean
  speakerRating: Int
  speakerFeedback: String
  venueRating: Int
  venueFeedback: String
  createdAt: String!
  updatedAt: String!
  }

  type VenueFeedback {
    id: ID!
    venueName: String!
    attendeeEmail: String!
    rating: Int!
    comment: String
    createdAt: String!
  }

  type SpeakerFeedback {
    id: ID!
    speakerEmail: String!
    eventId: ID!
    attendeeEmail: String!
    rating: Int!
    comment: String
    createdAt: String!
  }

  type Query {
    hello: String
    test: String
    countries: [Country]
    countryByCode(code: String!): Country
    events: [Event]
    eventsByCategory(category: String!): [Event]
    eventsByInterest(interest: String!): [Event]
    userEvents(email: String!): [Event]
    recommendedEvents(email: String!): [Event]
    pendingEvents: [Event]
    speakerInvitations(email: String!): [SpeakerInvitation]
    speakerNotifications(email: String!): [Notification]
    unreadNotificationCount(email: String!): Int
    availableSpeakers: [User]
    registeredAttendees(eventId: ID!): [User]
    eventFeedback(eventId: ID!): [EventFeedback]
    venueFeedback(venueName: String!): [VenueFeedback]
    speakerFeedback(speakerEmail: String!): [SpeakerFeedback]
    myFeedback(email: String!): [EventFeedback]
    speakerPastEvents(email: String!): [Event]
    speakerUpcomingEvents(email: String!): [Event]
    attendeePastEvents(email: String!): [Event]
    attendeeUpcomingEvents(email: String!): [Event]
    event(id: ID!): Event
    getEventSpeaker(eventId: ID!): Speaker
     getEventFeedbackForOrganizer(eventId: ID!): [EventFeedback]
  }

  type Mutation {
    signup(
      name: String!
      email: String!
      password: String!
      age: Int!
      role: String!
      contactNo: String!
      skills: [String]
      interests: [String]
      designation: String
      affiliation: String
      expertise: String
      countryCode: String
    ): String

    login(email: String!, password: String!): User
    
    updateUserCountry(email: String!, countryCode: String!): User

    createEvent(
      title: String!
      description: String!
      date: String!
      time: String!
      category: String!
      interest: String!
      creatorEmail: String!
      creatorName: String!
      venueName: String!
      venueUrl: String
      venueAddress: String
      speakerEmails: [String]
    ): Event

    respondToSpeakerInvitation(
      invitationId: ID!
      status: String!
    ): SpeakerInvitation

    updateEventStatus(
      eventId: ID!
      status: String!
    ): Event

    markNotificationAsRead(notificationId: ID!): Notification

    markInvitationAsRead(invitationId: ID!): SpeakerInvitation

    registerForEvent(
      eventId: ID!
      attendeeEmail: String!
    ): Event

    submitEventFeedback(
      eventId: ID!
      attendeeEmail: String!
      rating: Int!
      comment: String
    ): EventFeedback

    submitVenueFeedback(
      venueName: String!
      attendeeEmail: String!
      rating: Int!
      comment: String
    ): VenueFeedback

    submitSpeakerFeedback(
      speakerEmail: String!
      eventId: ID!
      attendeeEmail: String!
      rating: Int!
      comment: String
    ): SpeakerFeedback

    cancelEventRegistration(
      eventId: ID!
      attendeeEmail: String!
    ): Event

    updateEvent(
      eventId: ID!
      title: String
      description: String
      date: String
      time: String
      category: String
      interest: String
      venueName: String
      venueUrl: String
      venueAddress: String
    ): Event

    addSpeakerToEvent(
      eventId: ID!
      speakerEmail: String!
    ): Event

    removeSpeakerFromEvent(
      eventId: ID!
      speakerEmail: String!
    ): Event
    initiatePasswordReset(email: String!): Boolean
    verifyResetCode(email: String!, code: String!): Boolean
    updatePassword(email: String!, newPassword: String!): Boolean
  }
`;

const resolvers = {
  Query: {
    hello: () => "Hello from Neo4j GraphQL API",
    test: async () => {
      const session = driver.session();
      try {
        const result = await session.run('MATCH (n) RETURN count(n) AS count');
        return `Node count: ${result.records[0].get('count')}`;
      } catch (err) {
        console.error('Neo4j query error:', err);
        throw new Error('Neo4j test failed');
      } finally {
        await session.close();
      }
    },

    // In your resolvers.Query object
    getEventFeedbackForOrganizer: async (_, { eventId }, context) => {
      const session = driver.session();
      try {
        // Get email from authenticated user
        if (!context.req.headers.email) {
          throw new Error("Authentication required");
        }
        const email = context.req.headers.email;
        const organizerCheck = await session.run(
          `MATCH (e:Event)<-[:CREATED]-(o:Organizer {email: $email})
           RETURN count(o) > 0 as isOrganizer`,
          { 
            eventId,
            email
          }
        );
    if (!organizerCheck.records[0].get('isOrganizer')) {
      throw new Error("Only the event organizer can view this feedback");
    }

    // Get all feedback for the event
    const result = await session.run(
      `MATCH (e:Event)<-[:FOR_EVENT]-(ef:EventFeedback)<-[:PROVIDED_FEEDBACK]-(a:Attendee)
       OPTIONAL MATCH (ef)-[:HAS_SPEAKER_FEEDBACK]->(sf:SpeakerFeedback)
       OPTIONAL MATCH (ef)-[:HAS_VENUE_FEEDBACK]->(vf:VenueFeedback)
       RETURN ef, a.name as attendeeName, 
              sf.rating as speakerRating, sf.comment as speakerFeedback,
              vf.rating as venueRating, vf.comment as venueFeedback
       ORDER BY ef.createdAt DESC`,
      { eventId }
    );

    return result.records.map(record => {
      const feedback = record.get('ef').properties;
      return {
        id: feedback.id,
        eventId: feedback.eventId,
        attendeeEmail: feedback.attendeeEmail,
        attendeeName: record.get('attendeeName'),
        rating: feedback.rating,
        overallFeedback: feedback.comment,
        wouldAttendAgain: feedback.wouldAttendAgain || false,
        speakerRating: record.get('speakerRating'),
        speakerFeedback: record.get('speakerFeedback'),
        venueRating: record.get('venueRating'),
        venueFeedback: record.get('venueFeedback'),
        createdAt: feedback.createdAt,
        updatedAt: feedback.updatedAt || feedback.createdAt
      };
    });
  } catch (err) {
    console.error('Error fetching event feedback:', err);
    throw new Error(err.message || 'Failed to fetch event feedback');
  } finally {
    await session.close();
  }
},

    getEventSpeaker: async (_, { eventId }) => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (e:Event {id: $eventId})-[:HAS_SPEAKER]->(s:Speaker)
           RETURN s LIMIT 1`,
          { eventId }
        );
        if (result.records.length === 0) return null;

        const speaker = result.records[0].get('s').properties;
        return {
          email: speaker.email,
          name: speaker.name,
          expertise: speaker.expertise,
        };
      } catch (err) {
        console.error('Error fetching speaker:', err);
        throw new Error('Failed to fetch speaker');
      } finally {
        await session.close();
      }
    },
    countries: async () => {
      try {
        const countries = await fetchCountriesWithFallback();
        if (!countries || countries.length === 0) {
          throw new Error('No countries data available');
        }
        return countries;
      } catch (err) {
        console.error('Failed to fetch countries:', err);
        throw new Error('Failed to load countries. Please try again later.');
      }
    },
    countryByCode: async (_, { code }) => {
      try {
        const countries = await fetchCountriesWithFallback();
        const country = countries.find(c => c.code === code);
        
        if (!country) {
          try {
            const response = await axios.get(`https://restcountries.com/v3.1/alpha/${code}?fields=name,cca2,flags`);
            const apiCountry = response.data[0];
            return {
              name: apiCountry.name.common,
              code: apiCountry.cca2,
              flag: apiCountry.flags.png
            };
          } catch (apiError) {
            throw new Error('Country not found');
          }
        }
        
        return country;
      } catch (err) {
        console.error(`Failed to fetch country with code ${code}:`, err);
        throw new Error('Country fetch failed');
      }
    },
    events: async () => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (e:Event {status: 'ACTIVE'})-[:AT_VENUE]->(v:Venue)
           OPTIONAL MATCH (e)-[:HAS_SPEAKER]->(s:Speaker)
           RETURN e, v, collect(s) as speakers
           ORDER BY e.createdAt DESC`
        );
        
        return result.records.map(record => {
          const event = record.get('e').properties;
          const venue = record.get('v').properties;
          const speakers = record.get('speakers').map(s => s.properties);
          return {
            id: event.id,
            title: event.title,
            description: event.description,
            date: event.date,
            time: event.time,
            category: event.category,
            interest: event.interest,
            creatorEmail: event.creatorEmail,
            creatorName: event.creatorName,
            createdAt: event.createdAt,
            status: event.status,
            venue: {
              name: venue.name,
              url: venue.url,
              address: venue.address
            },
            speakers: speakers.map(s => ({
              email: s.email,
              name: s.name,
              status: s.status
            }))
          };
        });
      } catch (err) {
        console.error('Error fetching events:', err);
        throw new Error('Failed to fetch events');
      } finally {
        await session.close();
      }
    },
    eventsByCategory: async (_, { category }) => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (e:Event {category: $category, status: 'ACTIVE'})-[:AT_VENUE]->(v:Venue)
           OPTIONAL MATCH (e)-[:HAS_SPEAKER]->(s:Speaker)
           RETURN e, v, collect(s) as speakers
           ORDER BY e.createdAt DESC`,
          { category }
        );
        
        return result.records.map(record => {
          const event = record.get('e').properties;
          const venue = record.get('v').properties;
          const speakers = record.get('speakers').map(s => s.properties);
          return {
            id: event.id,
            title: event.title,
            description: event.description,
            date: event.date,
            time: event.time,
            category: event.category,
            interest: event.interest,
            creatorEmail: event.creatorEmail,
            creatorName: event.creatorName,
            createdAt: event.createdAt,
            status: event.status,
            venue: {
              name: venue.name,
              url: venue.url,
              address: venue.address
            },
            speakers: speakers.map(s => ({
              email: s.email,
              name: s.name,
              status: s.status
            }))
          };
        });
      } catch (err) {
        console.error('Error fetching events by category:', err);
        throw new Error('Failed to fetch events by category');
      } finally {
        await session.close();
      }
    },
    eventsByInterest: async (_, { interest }) => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (e:Event {interest: $interest, status: 'ACTIVE'})-[:AT_VENUE]->(v:Venue)
           OPTIONAL MATCH (e)-[:HAS_SPEAKER]->(s:Speaker)
           RETURN e, v, collect(s) as speakers
           ORDER BY e.createdAt DESC`,
          { interest }
        );
        
        return result.records.map(record => {
          const event = record.get('e').properties;
          const venue = record.get('v').properties;
          const speakers = record.get('speakers').map(s => s.properties);
          return {
            id: event.id,
            title: event.title,
            description: event.description,
            date: event.date,
            time: event.time,
            category: event.category,
            interest: event.interest,
            creatorEmail: event.creatorEmail,
            creatorName: event.creatorName,
            createdAt: event.createdAt,
            status: event.status,
            venue: {
              name: venue.name,
              url: venue.url,
              address: venue.address
            },
            speakers: speakers.map(s => ({
              email: s.email,
              name: s.name,
              status: s.status
            }))
          };
        });
      } catch (err) {
        console.error('Error fetching events by interest:', err);
        throw new Error('Failed to fetch events by interest');
      } finally {
        await session.close();
      }
    },
    userEvents: async (_, { email }) => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (u:Attendee|Organizer|Speaker {email: $email})-[:CREATED]->(e:Event)-[:AT_VENUE]->(v:Venue)
           OPTIONAL MATCH (e)-[:HAS_SPEAKER]->(s:Speaker)
           RETURN e, v, collect(s) as speakers
           ORDER BY e.createdAt DESC`,
          { email }
        );
        
        return result.records.map(record => {
          const event = record.get('e').properties;
          const venue = record.get('v').properties;
          const speakers = record.get('speakers').map(s => s.properties);
          return {
            id: event.id,
            title: event.title,
            description: event.description,
            date: event.date,
            time: event.time,
            category: event.category,
            interest: event.interest,
            creatorEmail: event.creatorEmail,
            creatorName: event.creatorName,
            createdAt: event.createdAt,
            status: event.status,
            venue: {
              name: venue.name,
              url: venue.url,
              address: venue.address
            },
            speakers: speakers.map(s => ({
              email: s.email,
              name: s.name,
              status: s.status
            }))
          };
        });
      } catch (err) {
        console.error('Error fetching user events:', err);
        throw new Error('Failed to fetch user events');
      } finally {
        await session.close();
      }
    },
    recommendedEvents: async (_, { email }) => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (u:Attendee {email: $email})-[:HAS_INTEREST]->(i:Interest)
           MATCH (e:Event {status: 'ACTIVE'})-[:HAS_INTEREST|RELATED_TO_INTEREST]->(i)
           WHERE NOT (u)-[:CREATED]->(e)
           MATCH (e)-[:AT_VENUE]->(v:Venue)
           OPTIONAL MATCH (e)-[:HAS_SPEAKER]->(s:Speaker)
           RETURN DISTINCT e, v, collect(s) as speakers
           ORDER BY e.createdAt DESC`,
          { email }
        );
        
        return result.records.map(record => {
          const event = record.get('e').properties;
          const venue = record.get('v').properties;
          const speakers = record.get('speakers').map(s => s.properties);
          return {
            id: event.id,
            title: event.title,
            description: event.description,
            date: event.date,
            time: event.time,
            category: event.category,
            interest: event.interest,
            creatorEmail: event.creatorEmail,
            creatorName: event.creatorName,
            createdAt: event.createdAt,
            status: event.status,
            venue: {
              name: venue.name,
              url: venue.url,
              address: venue.address
            },
            speakers: speakers.map(s => ({
              email: s.email,
              name: s.name,
              status: s.status
            }))
          };
        });
      } catch (err) {
        console.error('Error fetching recommended events:', err);
        throw new Error('Failed to fetch recommended events');
      } finally {
        await session.close();
      }
    },
    pendingEvents: async () => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (e:Event {status: 'PENDING'})-[:AT_VENUE]->(v:Venue)
           OPTIONAL MATCH (e)-[:HAS_SPEAKER]->(s:Speaker)
           RETURN e, v, collect(s) as speakers
           ORDER BY e.createdAt DESC`
        );
        
        return result.records.map(record => {
          const event = record.get('e').properties;
          const venue = record.get('v').properties;
          const speakers = record.get('speakers').map(s => s.properties);
          return {
            id: event.id,
            title: event.title,
            description: event.description,
            date: event.date,
            time: event.time,
            category: event.category,
            interest: event.interest,
            creatorEmail: event.creatorEmail,
            creatorName: event.creatorName,
            createdAt: event.createdAt,
            status: event.status,
            venue: {
              name: venue.name,
              url: venue.url,
              address: venue.address
            },
            speakers: speakers.map(s => ({
              email: s.email,
              name: s.name,
              status: s.status
            }))
          };
        });
      } catch (err) {
        console.error('Error fetching pending events:', err);
        throw new Error('Failed to fetch pending events');
      } finally {
        await session.close();
      }
    },
    speakerInvitations: async (_, { email }, context) => {
      if (context.req.body.variables.email !== email) {
        throw new Error("Not authorized");
      }
      
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (e:Event)-[r:HAS_SPEAKER]->(s:Speaker {email: $email})
           MATCH (e)-[:AT_VENUE]->(v:Venue)
           RETURN e.id as id, e as event, v as venue, r.status as status, 
                  r.isRead as isRead, r.createdAt as createdAt`,
          { email }
        );
        
        return result.records.map(record => {
          const event = record.get('event').properties;
          const venue = record.get('venue').properties;
          return {
            id: record.get('id'),
            eventId: event.id,
            speakerEmail: email,
            status: record.get('status'),
            isRead: record.get('isRead') || false,
            createdAt: record.get('createdAt'),
            event: {
              id: event.id,
              title: event.title,
              description: event.description,
              date: event.date,
              time: event.time,
              category: event.category,
              interest: event.interest,
              creatorEmail: event.creatorEmail,
              creatorName: event.creatorName,
              createdAt: event.createdAt,
              status: event.status,
              venue: {
                name: venue.name,
                url: venue.url,
                address: venue.address
              }
            }
          };
        });
      } catch (err) {
        console.error('Error fetching speaker invitations:', err);
        throw new Error('Failed to fetch speaker invitations');
      } finally {
        await session.close();
      }
    },
    speakerNotifications: async (_, { email }) => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (n:Notification {recipientEmail: $email})
           RETURN n
           ORDER BY n.createdAt DESC`,
          { email }
        );
        
        return result.records.map(record => {
          const notification = record.get('n').properties;
          return {
            id: notification.id,
            type: notification.type,
            message: notification.message,
            eventId: notification.eventId,
            isRead: notification.isRead || false,
            createdAt: notification.createdAt
          };
        });
      } catch (err) {
        console.error('Error fetching notifications:', err);
        throw new Error('Failed to fetch notifications');
      } finally {
        await session.close();
      }
    },
    unreadNotificationCount: async (_, { email }) => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (n:Notification {recipientEmail: $email, isRead: false})
           RETURN count(n) as count`,
          { email }
        );
        
        return result.records[0].get('count').toNumber();
      } catch (err) {
        console.error('Error fetching unread count:', err);
        return 0;
      } finally {
        await session.close();
      }
    },
    availableSpeakers: async () => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (u:Speaker)
           RETURN u`
        );
        
        return result.records.map(record => {
          const user = record.get('u').properties;
          return {
            name: user.name,
            email: user.email,
            expertise: user.expertise,
            affiliation: user.affiliation,
            role: 'Speaker'
          };
        });
      } catch (err) {
        console.error('Error fetching available speakers:', err);
        throw new Error('Failed to fetch available speakers');
      } finally {
        await session.close();
      }
    },
    registeredAttendees: async (_, { eventId }) => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (e:Event {id: $eventId})<-[:REGISTERED_FOR]-(a:Attendee)
           RETURN a`,
          { eventId }
        );
        
        return result.records.map(record => {
          const attendee = record.get('a').properties;
          return {
            id: eventId,
            name: attendee.name,
            email: attendee.email,
            role: 'Attendee'
            
          };
        });
      } catch (err) {
        console.error('Error fetching registered attendees:', err);
        throw new Error('Failed to fetch registered attendees');
      } finally {
        await session.close();
      }
    },

    // In your resolvers.Query object
userEvents: async (_, { email }) => {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (u:Organizer {email: $email})-[:CREATED]->(e:Event)-[:AT_VENUE]->(v:Venue)
       OPTIONAL MATCH (e)-[:HAS_SPEAKER]->(s:Speaker)
       RETURN e, v, collect(s) as speakers
       ORDER BY e.date DESC`,
      { email }
    );
    
    return result.records.map(record => {
      const event = record.get('e').properties;
      const venue = record.get('v').properties;
      const speakers = record.get('speakers').map(s => s.properties);
      return {
        id: event.id,
        title: event.title,
        description: event.description,
        date: event.date,
        time: event.time,
        category: event.category,
        interest: event.interest,
        creatorEmail: event.creatorEmail,
        creatorName: event.creatorName,
        createdAt: event.createdAt,
        status: event.status,
        venue: {
          name: venue.name,
          url: venue.url,
          address: venue.address
        },
        speakers: speakers.map(s => ({
          email: s.email,
          name: s.name,
        }))
      };
    });
  } catch (err) {
    console.error('Error fetching user events:', err);
    throw new Error('Failed to fetch user events');
  } finally {
    await session.close();
  }
},

    eventFeedback: async (_, { eventId }) => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (f:EventFeedback {eventId: $eventId})
           RETURN f
           ORDER BY f.createdAt DESC`,
          { eventId }
        );
        
        return result.records.map(record => {
          const feedback = record.get('f').properties;
          return {
            id: feedback.id,
            eventId: feedback.eventId,
            attendeeEmail: feedback.attendeeEmail,
            rating: feedback.rating,
            comment: feedback.comment,
            createdAt: feedback.createdAt
          };
        });
      } catch (err) {
        console.error('Error fetching event feedback:', err);
        throw new Error('Failed to fetch event feedback');
      } finally {
        await session.close();
      }
    },
    venueFeedback: async (_, { venueName }) => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (f:VenueFeedback {venueName: $venueName})
           RETURN f
           ORDER BY f.createdAt DESC`,
          { venueName }
        );
        
        return result.records.map(record => {
          const feedback = record.get('f').properties;
          return {
            id: feedback.id,
            venueName: feedback.venueName,
            attendeeEmail: feedback.attendeeEmail,
            rating: feedback.rating,
            comment: feedback.comment,
            createdAt: feedback.createdAt
          };
        });
      } catch (err) {
        console.error('Error fetching venue feedback:', err);
        throw new Error('Failed to fetch venue feedback');
      } finally {
        await session.close();
      }
    },
    speakerFeedback: async (_, { speakerEmail }) => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (f:SpeakerFeedback {speakerEmail: $speakerEmail})
           RETURN f
           ORDER BY f.createdAt DESC`,
          { speakerEmail }
        );
        
        return result.records.map(record => {
          const feedback = record.get('f').properties;
          return {
            id: feedback.id,
            speakerEmail: feedback.speakerEmail,
            eventId: feedback.eventId,
            attendeeEmail: feedback.attendeeEmail,
            rating: feedback.rating,
            comment: feedback.comment,
            createdAt: feedback.createdAt
          };
        });
      } catch (err) {
        console.error('Error fetching speaker feedback:', err);
        throw new Error('Failed to fetch speaker feedback');
      } finally {
        await session.close();
      }
    },
    myFeedback: async (_, { email }) => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (f:EventFeedback {attendeeEmail: $email})
           RETURN f
           ORDER BY f.createdAt DESC`,
          { email }
        );
        
        return result.records.map(record => {
          const feedback = record.get('f').properties;
          return {
            id: feedback.id,
            eventId: feedback.eventId,
            attendeeEmail: feedback.attendeeEmail,
            rating: feedback.rating,
            comment: feedback.comment,
            createdAt: feedback.createdAt
          };
        });
      } catch (err) {
        console.error('Error fetching user feedback:', err);
        throw new Error('Failed to fetch user feedback');
      } finally {
        await session.close();
      }
    },
    speakerPastEvents: async (_, { email }) => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (s:Speaker {email: $email})<-[:HAS_SPEAKER]-(e:Event)
           WHERE date(e.date) < date()
           MATCH (e)-[:AT_VENUE]->(v:Venue)
           RETURN e, v
           ORDER BY e.date DESC`,
          { email }
        );
        
        return result.records.map(record => {
          const event = record.get('e').properties;
          const venue = record.get('v').properties;
          return {
            id: event.id,
            title: event.title,
            description: event.description,
            date: event.date,
            time: event.time,
            category: event.category,
            interest: event.interest,
            creatorEmail: event.creatorEmail,
            creatorName: event.creatorName,
            createdAt: event.createdAt,
            status: event.status,
            venue: {
              name: venue.name,
              url: venue.url,
              address: venue.address
            }
          };
        });
      } catch (err) {
        console.error('Error fetching speaker past events:', err);
        throw new Error('Failed to fetch speaker past events');
      } finally {
        await session.close();
      }
    },
    speakerUpcomingEvents: async (_, { email }) => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (s:Speaker {email: $email})<-[:HAS_SPEAKER]-(e:Event)
           WHERE date(e.date) >= date()
           MATCH (e)-[:AT_VENUE]->(v:Venue)
           RETURN e, v
           ORDER BY e.date ASC`,
          { email }
        );
        
        return result.records.map(record => {
          const event = record.get('e').properties;
          const venue = record.get('v').properties;
          return {
            id: event.id,
            title: event.title,
            description: event.description,
            date: event.date,
            time: event.time,
            category: event.category,
            interest: event.interest,
            creatorEmail: event.creatorEmail,
            creatorName: event.creatorName,
            createdAt: event.createdAt,
            status: event.status,
            venue: {
              name: venue.name,
              url: venue.url,
              address: venue.address
            }
          };
        });
      } catch (err) {
        console.error('Error fetching speaker upcoming events:', err);
        throw new Error('Failed to fetch speaker upcoming events');
      } finally {
        await session.close();
      }
    },
    attendeePastEvents: async (_, { email }) => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (a:Attendee {email: $email})-[:REGISTERED_FOR]->(e:Event)
           WHERE date(e.date) < date()
           MATCH (e)-[:AT_VENUE]->(v:Venue)
           RETURN e, v
           ORDER BY e.date DESC`,
          { email }
        );
        
        return result.records.map(record => {
          const event = record.get('e').properties;
          const venue = record.get('v').properties;
          return {
            id: event.id,
            title: event.title,
            description: event.description,
            date: event.date,
            time: event.time,
            category: event.category,
            interest: event.interest,
            creatorEmail: event.creatorEmail,
            creatorName: event.creatorName,
            createdAt: event.createdAt,
            status: event.status,
            venue: {
              name: venue.name,
              url: venue.url,
              address: venue.address
            }
          };
        });
      } catch (err) {
        console.error('Error fetching attendee past events:', err);
        throw new Error('Failed to fetch attendee past events');
      } finally {
        await session.close();
      }
    },
    attendeeUpcomingEvents: async (_, { email }) => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (a:Attendee {email: $email})-[:REGISTERED_FOR]->(e:Event)
           WHERE date(e.date) >= date()
           MATCH (e)-[:AT_VENUE]->(v:Venue)
           RETURN e, v
           ORDER BY e.date ASC`,
          { email }
        );
        
        return result.records.map(record => {
          const event = record.get('e').properties;
          const venue = record.get('v').properties;
          return {
            id: event.id,
            title: event.title,
            description: event.description,
            date: event.date,
            time: event.time,
            category: event.category,
            interest: event.interest,
            creatorEmail: event.creatorEmail,
            creatorName: event.creatorName,
            createdAt: event.createdAt,
            status: event.status,
            venue: {
              name: venue.name,
              url: venue.url,
              address: venue.address
            }
          };
        });
      } catch (err) {
        console.error('Error fetching attendee upcoming events:', err);
        throw new Error('Failed to fetch attendee upcoming events');
      } finally {
        await session.close();
      }
    }
  },
  Mutation: {


    initiatePasswordReset: async (_, { email }) => {
      return await initiatePasswordReset(email);
    },
    verifyResetCode: async (_, { email, code }) => {
      return await verifyResetCode(email, code);
    },
    updatePassword: async (_, { email, newPassword }) => {
      return await updatePassword(email, newPassword);
    },

    signup: async (
      _,
      { name, email, password, age, role, contactNo, skills, interests, designation, affiliation, expertise, countryCode }
    ) => {
      const session = driver.session();
    
      try {
        // Validation checks
        if (
          !name?.trim() ||
          !email?.trim() ||
          !password ||
          !Number.isInteger(age) || age < 18 ||
          !role?.trim() ||
          !contactNo?.trim() ||
          !skills || !Array.isArray(skills) || skills.length === 0 ||
          !interests || !Array.isArray(interests) || interests.length === 0 ||
          (role === 'Organizer' && !designation?.trim()) ||
          (role === 'Speaker' && (!affiliation?.trim() || !expertise?.trim()))
        ) {
          throw new Error("All required fields must be filled correctly.");
        }
    
        // Check for existing email
        const existingUser = await session.run(
          `MATCH (u:Attendee|Organizer|Speaker {email: $email}) RETURN u`,
          { email }
        );
        if (existingUser.records.length > 0) {
          throw new Error("User with this email already exists.");
        }
    
        // Check for existing contact number - fixed query
        const existingContact = await session.run(
          `MATCH (u:Attendee|Organizer|Speaker) 
           WHERE u.contactNo IS NOT NULL AND u.contactNo = $contactNo 
           RETURN u LIMIT 1`,
          { contactNo }
        );
        
        if (existingContact.records.length > 0) {
          throw new Error("User with this contact number already exists.");
        }
    
        // Country code validation
        if (countryCode) {
          try {
            await axios.get(`https://restcountries.com/v3.1/alpha/${countryCode}`);
          } catch (err) {
            throw new Error("Invalid country code provided.");
          }
        }
    
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
    
        // Create user node
        const userNodeQuery = `
          CREATE (u:${role} {
            name: $name,
            email: $email,
            password: $password,
            age: $age,
            role: $role,
            contactNo: $contactNo,
            designation: $designation,
            affiliation: $affiliation,
            expertise: $expertise,
            countryCode: $countryCode
          })
          RETURN u
        `;
    
        await session.run(userNodeQuery, {
          name,
          email,
          password: hashedPassword,
          age,
          role,
          contactNo,
          designation: designation || "",
          affiliation: affiliation || "",
          expertise: expertise || "",
          countryCode: countryCode || ""
        });
    
        // Add skills
        for (const skill of skills) {
          await session.run(
            `MERGE (s:Skill {name: $skill})
             WITH s
             MATCH (u:${role} {email: $email})
             MERGE (u)-[:HAS_SKILL]->(s)`,
            { skill, email }
          );
        }
    
        // Add interests
        for (const interest of interests) {
          await session.run(
            `MERGE (i:Interest {name: $interest})
             WITH i
             MATCH (u:${role} {email: $email})
             MERGE (u)-[:HAS_INTEREST]->(i)`,
            { interest, email }
          );
        }
    
        // Add expertise if speaker
        if (expertise && role === 'Speaker') {
          await session.run(
            `MERGE (e:Expertise {name: $expertise})
             WITH e
             MATCH (u:Speaker {email: $email})
             MERGE (u)-[:HAS_EXPERTISE]->(e)`,
            { expertise, email }
          );
        }
    
        // Add country if provided
        if (countryCode) {
          const countryResponse = await axios.get(`https://restcountries.com/v3.1/alpha/${countryCode}`);
          const country = countryResponse.data[0];
          
          await session.run(
            `MERGE (c:Country {code: $code, name: $name, flag: $flag})
             WITH c
             MATCH (u:${role} {email: $email})
             MERGE (u)-[:FROM_COUNTRY]->(c)`,
            { 
              code: countryCode, 
              name: country.name.common,
              flag: country.flags.png,
              email 
            }
          );
        }
    
        return "User registered successfully.";
      } catch (err) {
        console.error("Signup error:", err);
        throw new Error(err.message || "Signup failed.");
      } finally {
        await session.close();
      }
    },
    login: async (_, { email, password }) => {
      const session = driver.session();

      try {
        const result = await session.run(
          `MATCH (u:Attendee|Organizer|Speaker {email: $email})
           RETURN u`,
          { email }
        );

        if (result.records.length === 0) {
          throw new Error("Invalid email or password.");
        }

        const user = result.records[0].get("u").properties;
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
          throw new Error("Invalid email or password.");
        }

        const relResult = await session.run(
          `MATCH (u:Attendee|Organizer|Speaker {email: $email})
           OPTIONAL MATCH (u)-[:HAS_SKILL]->(s:Skill)
           OPTIONAL MATCH (u)-[:HAS_INTEREST]->(i:Interest)
           OPTIONAL MATCH (u)-[:HAS_EXPERTISE]->(e:Expertise)
           OPTIONAL MATCH (u)-[:FROM_COUNTRY]->(c:Country)
           RETURN collect(DISTINCT s.name) AS skills,
                  collect(DISTINCT i.name) AS interests,
                  collect(DISTINCT e.name) AS expertise,
                  c.code AS countryCode`,
          { email }
        );

        const rels = relResult.records[0];

        return {
          name: user.name,
          email: user.email,
          age: user.age?.toNumber?.() || null,
          role: user.role,
          contactNo: user.contactNo,
          designation: user.designation,
          affiliation: user.affiliation,
          skills: rels.get("skills").filter(Boolean),
          interests: rels.get("interests").filter(Boolean),
          expertise: rels.get("expertise").filter(Boolean).join(', '),
          countryCode: rels.get("countryCode") || user.countryCode || null
        };
      } catch (err) {
        console.error("Login error:", err);
        throw new Error(err.message || "Login failed.");
      } finally {
        await session.close();
      }
    },
    updateUserCountry: async (_, { email, countryCode }) => {
      const session = driver.session();

      try {
        const userExists = await session.run(
          "MATCH (u:Attendee|Organizer|Speaker {email: $email}) RETURN u",
          { email }
        );
        
        if (userExists.records.length === 0) {
          throw new Error("User not found.");
        }

        const userRole = userExists.records[0].get("u").properties.role;

        try {
          const countryResponse = await axios.get(`https://restcountries.com/v3.1/alpha/${countryCode}`);
          const country = countryResponse.data[0];
          
          await session.run(
            `MATCH (u:${userRole} {email: $email})
             OPTIONAL MATCH (u)-[r:FROM_COUNTRY]->(:Country)
             DELETE r
             WITH u
             SET u.countryCode = $countryCode
             MERGE (c:Country {code: $code, name: $name, flag: $flag})
             MERGE (u)-[:FROM_COUNTRY]->(c)
             RETURN u`,
            { 
              email,
              countryCode,
              code: countryCode,
              name: country.name.common,
              flag: country.flags.png
            }
          );

          return await resolvers.Mutation.login(null, { 
            email, 
            password: 'dummyPassword'
          }).catch(() => {
            return {
              email,
              countryCode
            };
          });
          
        } catch (err) {
          throw new Error("Invalid country code provided.");
        }
      } catch (err) {
        console.error("Update country error:", err);
        throw new Error(err.message || "Failed to update country.");
      } finally {
        await session.close();
      }
    },
    createEvent: async (_, { 
      title, description, date, time, category, interest, 
      creatorEmail, creatorName, venueName, venueUrl, 
      venueAddress, speakerEmails
    }) => {
      const session = driver.session();
      
      try {
        if (!title?.trim() || !description?.trim() || !date || !time || 
            !category?.trim() || !interest?.trim() || 
            !creatorEmail?.trim() || !creatorName?.trim() ||
            !venueName?.trim()) {
          throw new Error("All required fields must be filled correctly.");
        }

        const creatorResult = await session.run(
          `MATCH (u:Attendee|Organizer|Speaker {email: $creatorEmail}) 
           RETURN labels(u) as labels`,
          { creatorEmail }
        );
        
        if (creatorResult.records.length === 0) {
          throw new Error("Creator not found");
        }

        const creatorRole = creatorResult.records[0].get("labels")[0];
        const eventId = crypto.randomBytes(16).toString('hex');
        const createdAt = new Date().toISOString();

        // Create event with PENDING status
        const result = await session.run(
          `CREATE (e:Event {
            id: $id,
            title: $title,
            description: $description,
            date: $date,
            time: $time,
            category: $category,
            interest: $interest,
            creatorEmail: $creatorEmail,
            creatorName: $creatorName,
            createdAt: $createdAt,
            status: 'PENDING'
          })
          WITH e
          MATCH (u:${creatorRole} {email: $creatorEmail})
          MERGE (u)-[:CREATED]->(e)
          
          MERGE (c:Category {name: $category})
          MERGE (e)-[:HAS_CATEGORY]->(c)
          
          MERGE (i:Interest {name: $interest})
          MERGE (e)-[:HAS_INTEREST]->(i)
          
          MERGE (v:Venue {
            name: $venueName,
            url: $venueUrl,
            address: $venueAddress
          })
          MERGE (e)-[:AT_VENUE]->(v)
          
          RETURN e, v`,
          {
            id: eventId,
            title,
            description,
            date,
            time,
            category,
            interest,
            creatorEmail,
            creatorName,
            createdAt,
            venueName,
            venueUrl: venueUrl || "",
            venueAddress: venueAddress || ""
          }
        );

        const event = result.records[0].get("e").properties;
        const venue = result.records[0].get("v").properties;

        // Add speaker invitations if provided
        if (speakerEmails && speakerEmails.length > 0) {
          for (const speakerEmail of speakerEmails) {
            const speakerResult = await session.run(
              `MATCH (s:Speaker {email: $speakerEmail})
               RETURN s`,
              { speakerEmail }
            );
            
            if (speakerResult.records.length > 0) {
              const speaker = speakerResult.records[0].get("s").properties;
              
              // Create invitation relationship
              await session.run(
                `MATCH (e:Event {id: $eventId})
                 MATCH (s:Speaker {email: $speakerEmail})
                 MERGE (e)-[r:HAS_SPEAKER]->(s)
                 SET r.status = 'PENDING', 
                     r.isRead = false,
                     r.createdAt = $createdAt`,
                { 
                  eventId,
                  speakerEmail,
                  createdAt
                }
              );

              // Create notification
              const notificationId = crypto.randomBytes(16).toString('hex');
              await session.run(
                `MATCH (s:Speaker {email: $speakerEmail})
                 CREATE (n:Notification {
                   id: $notificationId,
                   type: 'INVITATION',
                   message: 'You have been invited to speak at "${title}"',
                   eventId: $eventId,
                   isRead: false,
                   recipientEmail: $speakerEmail,
                   createdAt: $createdAt
                 })`,
                {
                  notificationId,
                  title,
                  eventId,
                  speakerEmail,
                  createdAt
                }
              );

              // Send email
              await sendInvitationEmail(
                speakerEmail, 
                {
                  title,
                  description,
                  date,
                  time,
                  venueName,
                  venueAddress,
                  creatorName,
                  creatorEmail
                },
                eventId
              );
            }
          }
        }

        return {
          id: event.id,
          title: event.title,
          description: event.description,
          date: event.date,
          time: event.time,
          category: event.category,
          interest: event.interest,
          creatorEmail: event.creatorEmail,
          creatorName: event.creatorName,
          createdAt: event.createdAt,
          status: event.status,
          venue: {
            name: venue.name,
            url: venue.url,
            address: venue.address
          }
        };
      } catch (err) {
        console.error("Error creating event:", err);
        throw new Error(err.message || "Failed to create event");
      } finally {
        await session.close();
      }
    },
    respondToSpeakerInvitation: async (_, { invitationId, status }) => {
      const session = driver.session();
      
      try {
        if (!['ACCEPTED', 'REJECTED'].includes(status)) {
          throw new Error("Invalid status. Must be either 'ACCEPTED' or 'REJECTED'");
        }
    
        // First get the speaker email before updating
        const getResult = await session.run(
          `MATCH (e:Event)-[r:HAS_SPEAKER]->(s:Speaker)
           WHERE e.id = $invitationId
           RETURN s.email as speakerEmail, e, r`,
          { invitationId }
        );
    
        if (getResult.records.length === 0) {
          throw new Error("Invitation not found");
        }
    
        const speakerEmail = getResult.records[0].get('speakerEmail');
        const event = getResult.records[0].get('e').properties;
        const relationship = getResult.records[0].get('r').properties;
    
        if (status === 'REJECTED') {
          // Delete the relationship if rejected
          await session.run(
            `MATCH (e:Event)-[r:HAS_SPEAKER]->(s:Speaker)
             WHERE e.id = $invitationId
             DETACH DELETE e`,
            { invitationId }
          );
        } else {
          // Update status if accepted
          await session.run(
            `MATCH (e:Event)-[r:HAS_SPEAKER]->(s:Speaker)
             WHERE e.id = $invitationId
             SET r.status = $status, r.isRead = true,
             e.status = 'ACTIVE'`,
            { invitationId, status }
          );
        }
    
        // Get venue details
        const venueResult = await session.run(
          `MATCH (e:Event {id: $eventId})-[:AT_VENUE]->(v:Venue)
           RETURN v`,
          { eventId: event.id }
        );
        const venue = venueResult.records[0]?.get('v')?.properties || {};
    
        // Get other speakers
        const speakersResult = await session.run(
          `MATCH (e:Event {id: $eventId})-[:HAS_SPEAKER]->(s:Speaker)
           RETURN collect(s) as speakers`,
          { eventId: event.id }
        );
        const speakers = speakersResult.records[0]?.get('speakers')?.map(s => s.properties) || [];
        console.log(speakers);
        return {
          id: invitationId,
          eventId: event.id,
          speakerEmail: speakerEmail,
          status: status,
          isRead: true,
          createdAt: relationship.createdAt || new Date().toISOString(),
          event: {
            ...event,
            venue: {
              name: venue.name || '',
              url: venue.url || '',
              address: venue.address || ''
            },
          }
        };
      } catch (err) {
        console.error("Error responding to speaker invitation:", err);
        throw new Error(err.message || "Failed to respond to speaker invitation");
      } finally {
        await session.close();
      }
    },
    markNotificationAsRead: async (_, { notificationId }) => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (n:Notification {id: $notificationId})
           SET n.isRead = true
           RETURN n`,
          { notificationId }
        );

        const notification = result.records[0].get('n').properties;
        return {
          id: notification.id,
          type: notification.type,
          message: notification.message,
          eventId: notification.eventId,
          isRead: true,
          createdAt: notification.createdAt
        };
      } catch (err) {
        console.error("Error marking notification as read:", err);
        throw new Error(err.message || "Failed to mark notification as read");
      } finally {
        await session.close();
      }
    },
    markInvitationAsRead: async (_, { invitationId }) => {
      const session = driver.session();
      try {
        const result = await session.run(
          `MATCH (e:Event)-[r:HAS_SPEAKER]->(s:Speaker)
           WHERE r.id = $invitationId
           SET r.isRead = true
           RETURN e, r, s`,
          { invitationId }
        );

        const event = result.records[0].get('e').properties;
        const invitation = result.records[0].get('r').properties;
        const speaker = result.records[0].get('s').properties;

        return {
          id: invitationId,
          eventId: event.id,
          speakerEmail: speaker.email,
          status: invitation.status,
          isRead: true,
          createdAt: invitation.createdAt,
          event: {
            id: event.id,
            title: event.title,
            description: event.description,
            date: event.date,
            time: event.time,
            category: event.category,
            interest: event.interest,
            creatorEmail: event.creatorEmail,
            creatorName: event.creatorName,
            createdAt: event.createdAt,
            status: event.status
          }
        };
      } catch (err) {
        console.error("Error marking invitation as read:", err);
        throw new Error(err.message || "Failed to mark invitation as read");
      } finally {
        await session.close();
      }
    },
    registerForEvent: async (_, { eventId, attendeeEmail }) => {
      const session = driver.session();
      try {
        // Check if already registered
        const checkResult = await session.run(
          `MATCH (a:Attendee {email: $attendeeEmail})-[:REGISTERED_FOR]->(e:Event {id: $eventId})
           RETURN count(a) as count`,
          { attendeeEmail, eventId }
        );
        
        if (checkResult.records[0].get('count').toNumber() > 0) {
          throw new Error("You are already registered for this event");
        }

        // Register the attendee
        await session.run(
          `MATCH (a:Attendee {email: $attendeeEmail})
           MATCH (e:Event {id: $eventId})
           MERGE (a)-[:REGISTERED_FOR]->(e)`,
          { attendeeEmail, eventId }
        );

        // Get the updated event details
        const eventResult = await session.run(
          `MATCH (e:Event {id: $eventId})-[:AT_VENUE]->(v:Venue)
           OPTIONAL MATCH (e)-[:HAS_SPEAKER]->(s:Speaker)
           RETURN e, v, collect(s) as speakers`,
          { eventId }
        );
        
        const event = eventResult.records[0].get('e').properties;
        const venue = eventResult.records[0].get('v').properties;
        const speakers = eventResult.records[0].get('speakers').map(s => s.properties);
        
        return {
          id: event.id,
          title: event.title,
          description: event.description,
          date: event.date,
          time: event.time,
          category: event.category,
          interest: event.interest,
          creatorEmail: event.creatorEmail,
          creatorName: event.creatorName,
          createdAt: event.createdAt,
          status: event.status
        };
      } catch (err) {
        console.error('Error registering for event:', err);
        throw new Error(err.message || 'Failed to register for event');
      } finally {
        await session.close();
      }
    },
    submitEventFeedback: async (_, { eventId, attendeeEmail, rating, comment }) => {
      const session = driver.session();
      try {
        if (rating < 1 || rating > 5) {
          throw new Error("Rating must be between 1 and 5");
        }
        
        const feedbackId = crypto.randomBytes(16).toString('hex');
        const createdAt = new Date().toISOString();
        
        const result = await session.run(
          `MATCH (e:Event {id: $eventId})
           MATCH (a:Attendee {email: $attendeeEmail})
           CREATE (f:EventFeedback {
             id: $feedbackId,
             eventId: $eventId,
             attendeeEmail: $attendeeEmail,
             rating: $rating,
             comment: $comment,
             createdAt: $createdAt
           })
           CREATE (a)-[:PROVIDED_FEEDBACK]->(f)-[:FOR_EVENT]->(e)
           RETURN f`,
          {
            feedbackId,
            eventId,
            attendeeEmail,
            rating,
            comment: comment || "",
            createdAt
          }
        );
        
        const feedback = result.records[0].get('f').properties;
        return {
          id: feedback.id,
          eventId: feedback.eventId,
          attendeeEmail: feedback.attendeeEmail,
          rating: feedback.rating,
          comment: feedback.comment,
          createdAt: feedback.createdAt
        };
      } catch (err) {
        console.error('Error submitting event feedback:', err);
        throw new Error(err.message || 'Failed to submit event feedback');
      } finally {
        await session.close();
      }
    },
    submitVenueFeedback: async (_, { venueName, attendeeEmail, rating, comment }) => {
      const session = driver.session();
      try {
        if (rating < 1 || rating > 5) {
          throw new Error("Rating must be between 1 and 5");
        }
        
        const feedbackId = crypto.randomBytes(16).toString('hex');
        const createdAt = new Date().toISOString();
        
        const result = await session.run(
          `MATCH (v:Venue {name: $venueName})
           MATCH (a:Attendee {email: $attendeeEmail})
           CREATE (f:VenueFeedback {
             id: $feedbackId,
             venueName: $venueName,
             attendeeEmail: $attendeeEmail,
             rating: $rating,
             comment: $comment,
             createdAt: $createdAt
           })
           CREATE (a)-[:PROVIDED_FEEDBACK]->(f)-[:FOR_VENUE]->(v)
           RETURN f`,
          {
            feedbackId,
            venueName,
            attendeeEmail,
            rating,
            comment: comment || "",
            createdAt
          }
        );
        
        const feedback = result.records[0].get('f').properties;
        return {
          id: feedback.id,
          venueName: feedback.venueName,
          attendeeEmail: feedback.attendeeEmail,
          rating: feedback.rating,
          comment: feedback.comment,
          createdAt: feedback.createdAt
        };
      } catch (err) {
        console.error('Error submitting venue feedback:', err);
        throw new Error(err.message || 'Failed to submit venue feedback');
      } finally {
        await session.close();
      }
    },
    
    submitSpeakerFeedback: async (_, { speakerEmail, eventId, attendeeEmail, rating, comment }) => {
      const session = driver.session();
      try {
        if (rating < 1 || rating > 5) {
          throw new Error("Rating must be between 1 and 5");
        }
        
        // Verify the speaker is actually associated with this event
        const verification = await session.run(
          `MATCH (e:Event {id: $eventId})-[:HAS_SPEAKER]->(s:Speaker {email: $speakerEmail})
           RETURN count(s) > 0 as isSpeaker`,
          { eventId, speakerEmail }
        );
        
        if (!verification.records[0].get('isSpeaker')) {
          throw new Error("This speaker is not associated with the specified event");
        }
        
        const feedbackId = crypto.randomBytes(16).toString('hex');
        const createdAt = new Date().toISOString();
        
        const result = await session.run(
          `MATCH (s:Speaker {email: $speakerEmail})
           MATCH (e:Event {id: $eventId})
           MATCH (a:Attendee {email: $attendeeEmail})
           CREATE (f:SpeakerFeedback {
             id: $feedbackId,
             speakerEmail: $speakerEmail,
             eventId: $eventId,
             attendeeEmail: $attendeeEmail,
             rating: $rating,
             comment: $comment,
             createdAt: $createdAt
           })
           CREATE (a)-[:PROVIDED_FEEDBACK]->(f)-[:FOR_SPEAKER]->(s)
           CREATE (f)-[:FOR_EVENT]->(e)
           RETURN f`,
          {
            feedbackId,
            speakerEmail,
            eventId,
            attendeeEmail,
            rating,
            comment: comment || "",
            createdAt
          }
        );
        
        const feedback = result.records[0].get('f').properties;
        return {
          id: feedback.id,
          speakerEmail: feedback.speakerEmail,
          eventId: feedback.eventId,
          attendeeEmail: feedback.attendeeEmail,
          rating: feedback.rating,
          comment: feedback.comment,
          createdAt: feedback.createdAt
        };
      } catch (err) {
        console.error('Error submitting speaker feedback:', err);
        throw new Error(err.message || 'Failed to submit speaker feedback');
      } finally {
        await session.close();
      }
    },
    cancelEventRegistration: async (_, { eventId, attendeeEmail }) => {
      const session = driver.session();
      try {
        // Remove registration relationship
        await session.run(
          `MATCH (a:Attendee {email: $attendeeEmail})-[r:REGISTERED_FOR]->(e:Event {id: $eventId})
           DELETE r`,
          { attendeeEmail, eventId }
        );

        // Get the updated event details
        const eventResult = await session.run(
          `MATCH (e:Event {id: $eventId})-[:AT_VENUE]->(v:Venue)
           OPTIONAL MATCH (e)-[:HAS_SPEAKER]->(s:Speaker)
           RETURN e, v, collect(s) as speakers`,
          { eventId }
        );
        
        const event = eventResult.records[0].get('e').properties;
        const venue = eventResult.records[0].get('v').properties;
        const speakers = eventResult.records[0].get('speakers').map(s => s.properties);
        
        return {
          id: event.id,
          title: event.title,
          description: event.description,
          date: event.date,
          time: event.time,
          category: event.category,
          interest: event.interest,
          creatorEmail: event.creatorEmail,
          creatorName: event.creatorName,
          createdAt: event.createdAt,
          status: event.status,
          venue: {
            name: venue.name,
            url: venue.url,
            address: venue.address
          },
          speakers: speakers.map(s => ({
            email: s.email,
            name: s.name,
            status: s.status
          }))
        };
      } catch (err) {
        console.error('Error canceling event registration:', err);
        throw new Error(err.message || 'Failed to cancel event registration');
      } finally {
        await session.close();
      }
    },
    updateEvent: async (_, { eventId, title, description, date, time, category, interest, venueName, venueUrl, venueAddress }) => {
      const session = driver.session();
      try {
        // Update event properties
        await session.run(
          `MATCH (e:Event {id: $eventId})
           SET e.title = COALESCE($title, e.title),
               e.description = COALESCE($description, e.description),
               e.date = COALESCE($date, e.date),
               e.time = COALESCE($time, e.time),
               e.category = COALESCE($category, e.category),
               e.interest = COALESCE($interest, e.interest)`,
          {
            eventId,
            title,
            description,
            date,
            time,
            category,
            interest
          }
        );

        // Update venue if provided
        if (venueName) {
          await session.run(
            `MATCH (e:Event {id: $eventId})-[:AT_VENUE]->(v:Venue)
             SET v.name = $venueName,
                 v.url = COALESCE($venueUrl, v.url),
                 v.address = COALESCE($venueAddress, v.address)`,
            {
              eventId,
              venueName,
              venueUrl,
              venueAddress
            }
          );
        }

        // Get the updated event details
        const eventResult = await session.run(
          `MATCH (e:Event {id: $eventId})-[:AT_VENUE]->(v:Venue)
           OPTIONAL MATCH (e)-[:HAS_SPEAKER]->(s:Speaker)
           RETURN e, v, collect(s) as speakers`,
          { eventId }
        );
        
        const event = eventResult.records[0].get('e').properties;
        const venue = eventResult.records[0].get('v').properties;
        const speakers = eventResult.records[0].get('speakers').map(s => s.properties);
        
        return {
          id: event.id,
          title: event.title,
          description: event.description,
          date: event.date,
          time: event.time,
          category: event.category,
          interest: event.interest,
          creatorEmail: event.creatorEmail,
          creatorName: event.creatorName,
          createdAt: event.createdAt,
          status: event.status,
          venue: {
            name: venue.name,
            url: venue.url,
            address: venue.address
          },
          speakers: speakers.map(s => ({
            email: s.email,
            name: s.name,
            status: s.status
          }))
        };
      } catch (err) {
        console.error('Error updating event:', err);
        throw new Error(err.message || 'Failed to update event');
      } finally {
        await session.close();
      }
    },
    addSpeakerToEvent: async (_, { eventId, speakerEmail }) => {
      const session = driver.session();
      try {
        // Check if speaker already added
        const checkResult = await session.run(
          `MATCH (e:Event {id: $eventId})-[:HAS_SPEAKER]->(s:Speaker {email: $speakerEmail})
           RETURN count(s) as count`,
          { eventId, speakerEmail }
        );
        
        if (checkResult.records[0].get('count').toNumber() > 0) {
          throw new Error("Speaker is already added to this event");
        }

        // Add speaker to event
        await session.run(
          `MATCH (e:Event {id: $eventId})
           MATCH (s:Speaker {email: $speakerEmail})
           MERGE (e)-[:HAS_SPEAKER]->(s)`,
          { eventId, speakerEmail }
        );

        // Get the updated event details
        const eventResult = await session.run(
          `MATCH (e:Event {id: $eventId})-[:AT_VENUE]->(v:Venue)
           OPTIONAL MATCH (e)-[:HAS_SPEAKER]->(s:Speaker)
           RETURN e, v, collect(s) as speakers`,
          { eventId }
        );
        
        const event = eventResult.records[0].get('e').properties;
        const venue = eventResult.records[0].get('v').properties;
        const speakers = eventResult.records[0].get('speakers').map(s => s.properties);
        
        return {
          id: event.id,
          title: event.title,
          description: event.description,
          date: event.date,
          time: event.time,
          category: event.category,
          interest: event.interest,
          creatorEmail: event.creatorEmail,
          creatorName: event.creatorName,
          createdAt: event.createdAt,
          status: event.status,
          venue: {
            name: venue.name,
            url: venue.url,
            address: venue.address
          },
          speakers: speakers.map(s => ({
            email: s.email,
            name: s.name,
            status: s.status
          }))
        };
      } catch (err) {
        console.error('Error adding speaker to event:', err);
        throw new Error(err.message || 'Failed to add speaker to event');
      } finally {
        await session.close();
      }
    },
    removeSpeakerFromEvent: async (_, { eventId, speakerEmail }) => {
      const session = driver.session();
      try {
        // Remove speaker from event
        await session.run(
          `MATCH (e:Event {id: $eventId})-[r:HAS_SPEAKER]->(s:Speaker {email: $speakerEmail})
           DELETE r`,
          { eventId, speakerEmail }
        );

        // Get the updated event details
        const eventResult = await session.run(
          `MATCH (e:Event {id: $eventId})-[:AT_VENUE]->(v:Venue)
           OPTIONAL MATCH (e)-[:HAS_SPEAKER]->(s:Speaker)
           RETURN e, v, collect(s) as speakers`,
          { eventId }
        );
        
        const event = eventResult.records[0].get('e').properties;
        const venue = eventResult.records[0].get('v').properties;
        const speakers = eventResult.records[0].get('speakers').map(s => s.properties);
        
        return {
          id: event.id,
          title: event.title,
          description: event.description,
          date: event.date,
          time: event.time,
          category: event.category,
          interest: event.interest,
          creatorEmail: event.creatorEmail,
          creatorName: event.creatorName,
          createdAt: event.createdAt,
          status: event.status,
          venue: {
            name: venue.name,
            url: venue.url,
            address: venue.address
          },
          speakers: speakers.map(s => ({
            email: s.email,
            name: s.name,
            status: s.status
          }))
        };
      } catch (err) {
        console.error('Error removing speaker from event:', err);
        throw new Error(err.message || 'Failed to remove speaker from event');
      } finally {
        await session.close();
      }
    }
  }
};

// Start Apollo Server
const server = new ApolloServer({ 
  typeDefs, 
  resolvers,
  context: ({ req }) => {
    return {
      driver,
      req
    };
  }
});

async function startServer() {
  // Add this before starting the server
  app.post('/api/send-invitation', async (req, res) => {
    try {
      const { speakerEmail, eventDetails, invitationId } = req.body;
      
      if (!speakerEmail || !eventDetails || !invitationId) {
        return res.status(400).json({ 
          success: false, 
          message: 'Missing required fields' 
        });
      }

      await sendInvitationEmail(speakerEmail, eventDetails, invitationId);
      
      res.status(200).json({ 
        success: true, 
        message: 'Invitation email sent successfully' 
      });
    } catch (error) {
      console.error('Error in /api/send-invitation:', error);
      res.status(500).json({ 
        success: false, 
        message: error.message || 'Failed to send invitation email' 
      });
    }
  });

  // Keep your existing invitation acceptance/rejection routes
  app.get('/api/invitations/accept/:id', async (req, res) => {
    try {
      const session = driver.session();
      const invitationId = req.params.id;
      
      await session.run(
        `MATCH (i:Invitation {id: $id})
         SET i.status = 'ACCEPTED', i.updatedAt = $updatedAt`,
        {
          id: invitationId,
          updatedAt: new Date().toISOString()
        }
      );
      
      res.send('Invitation accepted successfully. Event has been created.');
    } catch (err) {
      console.error('Error accepting invitation:', err);
      res.status(500).send('Failed to accept invitation');
    }
  });

  app.get('/api/invitations/reject/:id', async (req, res) => {
    const session = driver.session();
    const invitationId = req.params.id;

    try {
      await session.run(
        `
        MATCH (i:Invitation {id: $id})
        SET i.status = 'REJECTED', i.updatedAt = $updatedAt
        DETACH DELETE i
        `,
        {
          id: invitationId,
          updatedAt: new Date().toISOString()
        }
      );

      res.status(200).send({ success: true, message: 'Invitation rejected and deleted' });
    } catch (error) {
      console.error('Error rejecting invitation:', error);
      res.status(500).send({ success: false, message: 'Failed to reject invitation' });
    } finally {
      await session.close();
    }
  });

  app.get('/api/countries', async (req, res) => {
    try {
      const countries = await fetchCountriesWithFallback();
      if (!countries || countries.length === 0) {
        return res.status(503).json({ error: 'Countries data temporarily unavailable' });
      }
      res.json(countries);
    } catch (err) {
      console.error('Failed to fetch countries:', err);
      res.status(500).json({ error: 'Failed to fetch countries' });
    }
  });

  await server.start();
  server.applyMiddleware({ app });

  try {
    await fetchCountriesWithFallback();
    console.log('Countries data pre-loaded');
  } catch (err) {
    console.error('Failed to pre-load countries:', err);
  }

  app.use('/api/password-reset', resetPasswordLimiter);

// Add REST endpoints for password reset
app.post('/api/password-reset/request', async (req, res) => {
  try {
    const { email } = req.body;
    await initiatePasswordReset(email);
    res.json({ success: true, message: 'If an account exists with this email, a reset code has been sent' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/password-reset/verify', async (req, res) => {
  try {
    const { email, code } = req.body;
    await verifyResetCode(email, code);
    res.json({ success: true, message: 'Code verified successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/password-reset/update', async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    await updatePassword(email, newPassword);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

  app.listen(port, () => {
    console.log(`🚀 Server running at http://localhost:${port}`);
    console.log(`🚀 GraphQL endpoint at http://localhost:${port}${server.graphqlPath}`);
    console.log(`🚀 REST Countries endpoint at http://localhost:${port}/api/countries`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});