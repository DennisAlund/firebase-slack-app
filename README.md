# Ping Pong: A firebase Slack app
This project was created as an example of how to build a Slack App using Firebase 
as the only backend. The full explanation and walk through of the code can be found 
on Medium: 
[https://medium.com/evenbit/building-a-slack-app-with-firebase-as-a-backend-151c1c98641d](https://goo.gl/Hh75Z0)   

The project is designed for showcasing functionality, not for making any sense. 

# Where to Ping Pong
You can download or fork this repository for your own usage or you can install
the demo project from its project website: 
[https://fir-slack-app.firebaseapp.com/](https://goo.gl/MyOrTq)

## Configuration 
Please see the [Travis configuration file](.travis.yml) for instructions on how
to configure and deploy the project if you wish to fork or download it.

The Firebase cloud function configuration variables for Slack are the ones that
you'll find in your project configuration 
[https://api.slack.com/apps/YOURPROJECT/general](https://api.slack.com/apps/YOURPROJECT/general)

![Slack app credentials](public/images/app_credenials.png?raw=true "Slack App Credentials")


# How to Ping Pong

1. Install the Slack app to your team.
2. Choose the channel in which Ping Pong is being played (e.g. #general)
3. Start a Ping Pong challenge with the command `/ping`
4. Soon your ping request is being published in the channel that you configured 
during installation.
5. Team members should click the "pong" button as soon as possible.
6. The challenge is over when at least three people has clicked "pong"
7. The app will publish the score and reaction time for the first three players
to click "pong"


# LICENSE
Copyright 2017 Dennis Alund

```
   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```