const express = require('express');
const connectDB = require('./config/db');
const path = require('path');
const app = express();
const PORT = 8080;
const mongoose = require('mongoose');
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const multer = require('multer');
const AudioProcessor = require('./audioProcessor/audioProcessor.js');

// Connect Database
connectDB();
// Initialize Middleware
app.use(express.json());
// The line of code should get commented out when deploying, bring it back if testing on local machine server.
//app.get('/', (req, res) => res.send('API Running...'));
// Define Routes
app.use('/api/users', require('./routes/api/users'));
app.use('/api/auth', require('./routes/api/auth'));
app.use('/api/compositions', require('./routes/api/compositions'));
app.use('/api/uploaddownload', require('./routes/api/uploaddownload'));
app.use('/api/profile', require('./routes/api/profile'));
app.use('/api/posts', require('./routes/api/posts'));

// Socket Code
const Role = {
  LISTENER: 0,
  PERFORMER: 1
};

availableRooms = {}; // Currently active rooms
memberAttendance = {}; // Maps socketId to roomId

io.on('connection', function (socket) {
  console.log(`Received connection from socket: ${socket.id}.`);

  const rooms = availableRooms;
  socket.emit('updaterooms', rooms);

  // Rooms' ids
  socket.on('createroom', function (data) {
    console.log(`Received createroom from socket: ${socket.id}.`);

    const room = data.room;
    const roomId = room['id'];
    const member = data.member;

    availableRooms[roomId] = room;
    availableRooms[roomId]['members'] = {};
    availableRooms[roomId]['members'][socket.id] = member;
    availableRooms[roomId]['members'][socket.id]['socket'] = socket.id;
    availableRooms[roomId]['audioProcessor'] = new AudioProcessor();
    
    if (member.role == Role.PERFORMER) {
      availableRooms[roomId]['audioProcessor'].addPerformer(socket.id);
    }

    memberAttendance[socket.id] = roomId;
    socket.join(roomId);
    io.to(roomId).emit('updatemembers', availableRooms[roomId]['members']);
  });

  socket.on('leaveroom', function (roomId) {
    const existingRoom = availableRooms[roomId];

    if (!existingRoom) {
      io.to(roomId).emit('roomerror', 'Room data does not exist. Please exit.');
      return;
    }

    const memberList = existingRoom['members'];

    if (!memberList) {
      io.to(roomId).emit(
        'roomerror',
        "This room's member data is missing. Please exit."
      );
      return;
    }

    const user = memberList[socket.id];

    if (!user) {
      return;
    }

    // If the host is leaving, clear the room
    if (user['isHost']) {
      console.log('Host is leaving.');
      delete availableRooms[roomId];

      io.of('/')
        .in(roomId)
        .clients((error, socketIds) => {
          if (error) throw error;

          socketIds.forEach((socketId) => {
            io.sockets.sockets[socketId].emit(
              'roomerror',
              `The host has disconnected. Please exit the room.`
            );

            delete memberAttendance[socketId];
            io.sockets.sockets[socketId].leave(roomId);
            io.sockets.sockets[socketId].emit('updaterooms', availableRooms);
          });
        });
    }
    // If non-host is leaving, handle them exclusively
    else {
      console.log('Non-host is leaving.');
      delete memberAttendance[socket.id];
      socket.leave(roomId);

      const member = availableRooms[roomId]['members'][socket.id];

      if (!member) {
        console.log(
          `(leaveroom) Leaving member\'s data does not exist in room: ${roomId}.`
        );
        return;
      }

      const memberRole = member['role'];
      delete availableRooms[roomId]['members'][socket.id];

      if (memberRole == Role.LISTENER) {
        console.log('A listener member is leaving.');
        availableRooms[roomId]['currentListeners']--;
      } else {
        console.log('A performer member is leaving.');
        availableRooms[roomId]['audioProcessor'].removePerformer(socket.id);
        availableRooms[roomId]['currentPerformers']--;
      }

      io.to(roomId).emit('updatemembers', availableRooms[roomId]['members']);

      const existingRoom = availableRooms[roomId];

      if (existingRoom) {
        delete availableRooms[roomId]['members'][socket.id];

        if (member['role'] == Role.LISTENER) {
          availableRooms[roomId]['currentListeners']--;
        } else {
          availableRooms[roomId]['currentPerformers']--;
        }

        io.to(roomId).emit('updatemembers', availableRooms[roomId]['members']);
      }
    }
  });

  socket.on('verifypin', function (data) {
    console.log(`Received verifypin from socket: ${socket.id}`);

    const roomId = data.roomId;
    const enteredPin = data.enteredPin;
    const room = availableRooms[roomId];

    if (!room) {
      console.log('Attempting to join nonexistent room.');
      socket.emit('verifypin', 'This room is no longer available.');
      return;
    } else {
      if (enteredPin == room['pin']) {
        socket.emit('verifypin', room['pin']);
        return;
      }
      socket.emit('verifypin', 'The entered PIN is incorrect.');
    }
  });

  // Non-host actions
  socket.on('joinroom', function (data) {
    console.log(`Received joinroom from socket: ${socket.id}.`);

    const roomId = data.roomId;
    const member = data.member;

    const room = availableRooms[roomId];
    if (!room) {
      console.log(`(joinroom) Room does not exist.`);
      socket.emit('roomerror', 'This room does not exist.');
      return;
    }

    const roomMembers = room['members'];

    if (!roomMembers) {
      console.log("(joinroom) This room's member data seems to be missing.");
      socket.emit(
        'joinerror',
        "This room's member data seems to be missing. Please exit."
      );
      return;
    } else {
      if (member['role'] == Role.LISTENER) {
        if (
          availableRooms[roomId]['currentListeners'] ==
          availableRooms[roomId]['maxListeners']
        ) {
          socket.emit(
            'roomerror',
            "This room's max listener capacity was reached. Please exit."
          );
          return;
        }
        availableRooms[roomId]['currentListeners']++;
      } else {
        if (
          availableRooms[roomId]['currentPerformers'] ==
          availableRooms[roomId]['maxPerformers']
        ) {
          console.log('Max performers reached...');
          socket.emit(
            'roomerror',
            "This room's max performer capacity was reached. Please exit."
          );
          return;
        }
        // If a valid performer joined the room, add them to the audio processor
        availableRooms[roomId]['audioProcessor'].addPerformer(socket.id)

        availableRooms[roomId]['currentPerformers']++;
      }

      availableRooms[roomId]['members'][socket.id] = member;
      memberAttendance[socket.id] = roomId;

      socket.join(roomId);
      io.to(roomId).emit('updatemembers', availableRooms[roomId]['members']);
    }
  });

  socket.on('startsession', function (roomId) {
    console.log(`Received startsession from socket: ${socket.id}.`);

    const existingRoom = availableRooms[roomId];

    if (!existingRoom) {
      io.to(roomId).emit(
        'roomerror',
        'Non-host is attempting to start session. Functionality is unavailable.'
      );
      return;
    }

    const memberList = existingRoom['members'];

    if (!memberList) {
      io.to(roomId).emit('roomerror', "This room's member data is missing.");
      return;
    }

    const user = memberList[socket.id];

    if (!user) {
      return;
    }

    // If the host is leaving, clear the room
    if (user['isHost']) {
      console.log(`Yep! You're the host! Time to partyyyy!`);
      io.to(roomId).emit('audiostart', null);
    }
  });

  // Iterate through members of roomId whose roles are LISTENER
  // Then, pass them the audio data
  socket.on('sendaudio', function (data) {
    const roomId = memberAttendance[socket.id];

    if (!roomId) {
      return;
    }

    // console.log('Received sendaudio message.');
    // console.log(`Audio data in server: ${data.length}`);

    // Buffer the audio from this performer. If there is enough
    // audio data to process and mix, the mixed audio data is 
    // returned here.  Otherwise, it returns null
    var processedAudio = availableRooms[roomId]['audioProcessor'].buffer(socket.id, data)

    // If the audio was processed sucessfully, send it to the listeners
    if (processedAudio != null) {
      for (var member in availableRooms[roomId]['members']) {
        details = availableRooms[roomId]['members'][member];

        if (details['role'] == Role.LISTENER) {
          console.log(`${details['username']} is a listener!`);
          io.to(details['socket']).emit('playaudio', processedAudio);
        }
      }
    }
  });

  socket.on('endsession', function (roomId) {
    console.log(`Received endsession from socket: ${socket.id}.`);
    const existingRoom = availableRooms[roomId];

    if (!existingRoom) {
      io.to(roomId).emit(
        'roomerror',
        'Cannot end session of nonexistent room. Please exit.'
      );
      return;
    }

    delete availableRooms[roomId];

    io.of('/')
      .in(roomId)
      .clients((error, socketIds) => {
        if (error) throw error;

        socketIds.forEach((socketId) => {
          delete memberAttendance[socketId];
          io.sockets.sockets[socketId].emit(
            'audiostop',
            `This room's session has ended. Please exit.`
          );
          io.sockets.sockets[socketId].leave(roomId);
          io.sockets.sockets[socketId].emit('updaterooms', availableRooms);
        });
      });

    // Make API call
    var formData = new FormData();
    var file = fs.createReadStream(`test.mp3`);

    formData.append('file', file);
    formData.append('data', JSON.stringify(data)); // Composition metadata here

    const response = await fetch('https://johncagetribute.org/api/compositions', { method: 'POST', body: formData });
  });

  socket.on('disconnect', function () {
    console.log(`Received disconnect from socket: ${socket.id}.`);

    const roomId = memberAttendance[socket.id];
    console.log(`Checking roomId: ${roomId}`);
    if (roomId != null) {
      const existingRoom = availableRooms[roomId];
      console.log(`Checking existingRoom: ${existingRoom}`);

      if (!existingRoom) {
        io.to(roomId).emit(
          'roomerror',
          'Room data does not exist. Please exit.'
        );
       
        return;
      }

      const member = existingRoom['members'][socket.id];

      // Upon a host's disconnection, the room must be removed
      if (member['isHost']) {
        delete availableRooms[roomId];

        io.of('/')
          .in(roomId)
          .clients((error, socketIds) => {
            if (error) throw error;

            socketIds.forEach((socketId) => {
               delete memberAttendance[socketId];
               io.sockets.sockets[socketId].emit(
                 'roomerror',
                 `The host has disconnected. Please exit the room.`
               );

               io.sockets.sockets[socketId].leave(roomId);
               io.sockets.sockets[socketId].emit(
                 'updaterooms',
                 availableRooms
               );
             });
           });
       }

      // When a non-host disconnects, the room and members size is updated
      else {
        const member = existingRoom['members'][socket.id];
          if (!member) {
            console.log('Member data missing.');
            return;
          }

          if (member['role'] == Role.LISTENER) {
            availableRooms[roomId]['currentListeners']--;
          } else {
            availableRooms[roomId]['currentPerformers']--;
          }

          delete memberAttendance[socket.id];
          delete availableRooms[roomId]['members'][socket.id];
          io.to(roomId).emit(
            'updatemembers',
            availableRooms[roomId]['members']
          );
        }
      }
  });

  socket.on('updaterooms', function () {
    console.log(`Received updaterooms from socket: ${socket.id}.`);

    const existingRooms = availableRooms;
    socket.emit('updaterooms', existingRooms);
  });
});
// Serve static assets in production
// Set static folder (Comment out next 4 lines if running locally)
app.use(express.static('client/build'));
app.get('*', (req, res) => {
res.sendFile(path.resolve(__dirname, 'client', 'build', 'index.html'));
});
http.listen(PORT, () => console.log(`Server Started on port ${PORT}`));
